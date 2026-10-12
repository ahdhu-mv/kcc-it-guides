/**
 * Request-level identity, CSRF and access rules shared by pages and API routes.
 */
import { csrfOk, csrfToken, fetchIdentity, type Identity } from "./auth";
import { HttpError } from "./errors";
import { categoryMap, type Category } from "./guides";
import type { Services } from "./services";

const touched = new Map<string, number>();

/** Test helper. */
export function resetSessionState(): void {
  touched.clear();
}

export type Session = { user: Identity; csrf: string };

/** Identify the caller from request headers. Null means "not signed in". */
export async function identify(
  svc: Services, headers: Headers, method: string, pathWithQuery: string,
): Promise<Session | null> {
  const clientIp = headers.get("x-real-ip") || (headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const user = await fetchIdentity(svc.cfg, headers.get("cookie") ?? "", method, pathWithQuery, clientIp);
  if (!user) return null;
  if (Date.now() - (touched.get(user.username) ?? 0) > 60_000) {
    svc.db.touchUser(user.username, user.name, user.email);
    touched.set(user.username, Date.now());
  }
  return { user, csrf: csrfToken(svc.cfg.secretKey, user.username) };
}

export function loginUrl(svc: Services, pathWithQuery: string, method = "GET"): string {
  return `${svc.cfg.authPortalUrl}/?rd=${encodeURIComponent(svc.cfg.publicOrigin + pathWithQuery)}&rm=${method}`;
}

/** For state-changing requests: same-origin and a valid CSRF token. */
export function assertSafeRequest(svc: Services, req: Request, user: Identity): void {
  const origin = req.headers.get("origin");
  if (origin && origin !== svc.cfg.publicOrigin) {
    throw new HttpError(403, "Request blocked", "That request came from another site.");
  }
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    throw new HttpError(403, "Request blocked", "That request came from another site.");
  }
  if (!csrfOk(svc.cfg.secretKey, user.username, req.headers.get("x-csrf-token"))) {
    throw new HttpError(400, "Page expired",
      "Your page expired or was not valid. Reload the page and try again.");
  }
}

// ---------------------------------------------------------------- access

export function accessibleCategories(svc: Services, user: Identity, root: string): Record<string, Category> {
  const cmap = categoryMap(root);
  if (user.isAdmin) return cmap;
  const out: Record<string, Category> = {};
  for (const d of svc.db.departmentsForUser(user.username)) {
    out[d.slug] = cmap[d.slug] ?? { slug: d.slug, name: d.slug, color: "#7c8a94" };
  }
  return out;
}

export function getCategory(svc: Services, user: Identity, root: string, slug: string): Category {
  const cmap = categoryMap(root);
  const allowed = accessibleCategories(svc, user, root);
  if (Object.prototype.hasOwnProperty.call(allowed, slug)) return allowed[slug];
  if (Object.prototype.hasOwnProperty.call(cmap, slug)) {
    throw new HttpError(403, "No access to this category",
      "You are not a member of the department that manages this category.");
  }
  throw new HttpError(404, "Category not found", "That category doesn't exist.");
}

export function requireAdmin(user: Identity): void {
  if (!user.isAdmin) {
    throw new HttpError(403, "Administrators only", "This page is for the IT administrators of the guides site.");
  }
}
