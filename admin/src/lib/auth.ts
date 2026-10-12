/**
 * Who is signed in?  This app never trusts a header a browser could forge.
 * For every request it asks Authelia directly, passing along the visitor's
 * session cookie, and uses Authelia's answer (the same check a reverse proxy
 * makes). No cookie, or an invalid one, means Authelia says 401 and the
 * visitor is sent to the login page.
 */
import crypto from "node:crypto";
import type { Config } from "./config";
import { HttpError } from "./errors";

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export type Identity = {
  username: string;
  name: string;
  email: string;
  groups: string[];
  isAdmin: boolean;
};

const cache = new Map<string, { until: number; identity: Identity }>();

export function clearAuthCache(): void {
  cache.clear();
}

function isAdmin(cfg: Config, username: string, groups: string[]): boolean {
  const wanted = cfg.adminGroup.toLowerCase();
  return cfg.adminUsers.has(username) || (!!wanted && groups.some((g) => g.toLowerCase() === wanted));
}

/** Returns the identity, or null when not signed in. Throws HttpError for Authelia problems. */
export async function fetchIdentity(
  cfg: Config, cookie: string, method: string, pathWithQuery: string, clientIp: string,
): Promise<Identity | null> {
  if (!cookie) return null;
  const key = crypto.createHash("sha256").update(cookie).digest("hex");
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.identity;

  const pub = new URL(cfg.publicUrl);
  let resp: Response;
  try {
    resp = await fetch(`${cfg.autheliaUrl}/api/authz/auth-request`, {
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      headers: {
        Cookie: cookie,
        "X-Original-Method": method,
        "X-Original-URL": cfg.publicOrigin + pathWithQuery,
        "X-Forwarded-Proto": pub.protocol.replace(":", ""),
        "X-Forwarded-Host": pub.host,
        "X-Forwarded-URI": pathWithQuery,
        "X-Forwarded-For": clientIp,
        "User-Agent": "kcc-guides-admin",
      },
    });
  } catch (err) {
    throw new HttpError(503, "Sign-in service unavailable",
      `The login service could not be reached (${(err as Error).message}). Please try again in a minute.`);
  }
  if (resp.status === 401) return null;
  if (resp.status === 403) {
    throw new HttpError(403, "Access denied",
      "You are signed in, but the login service does not allow you to open this site. " +
      "Ask IT if you think that is a mistake.");
  }
  if (resp.status !== 200) {
    throw new HttpError(503, "Sign-in service unavailable", `The login service answered HTTP ${resp.status}.`);
  }

  const username = (resp.headers.get("Remote-User") ?? "").trim().toLowerCase();
  if (!USERNAME_RE.test(username)) return null;
  const groups = (resp.headers.get("Remote-Groups") ?? "").split(",").map((g) => g.trim()).filter(Boolean);
  const identity: Identity = {
    username,
    name: (resp.headers.get("Remote-Name") ?? username).trim().slice(0, 80) || username,
    email: (resp.headers.get("Remote-Email") ?? "").trim().slice(0, 120),
    groups,
    isAdmin: isAdmin(cfg, username, groups),
  };
  if (cache.size > 500) cache.clear();
  cache.set(key, { until: Date.now() + cfg.authCacheTtlMs, identity });
  return identity;
}

export function csrfToken(secret: string, username: string): string {
  return crypto.createHmac("sha256", secret).update(`csrf:${username}`).digest("hex");
}

export function csrfOk(secret: string, username: string, supplied: string | null | undefined): boolean {
  if (!supplied) return false;
  const a = Buffer.from(csrfToken(secret, username));
  const b = Buffer.from(supplied);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
