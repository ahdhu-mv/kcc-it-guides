import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type Config = {
  dataDir: string;
  /** Set = guides are plain files in this folder (no git). Empty = a GitHub clone. */
  siteDir: string;
  repoUrl: string;
  repoBranch: string;
  gitSshCommand: string;
  publicUrl: string;
  publicOrigin: string;
  authPortalUrl: string;
  autheliaUrl: string;
  guidesSiteUrl: string;
  secretKey: string;
  adminUsers: Set<string>;
  adminGroup: string;
  timezone: string;
  committerName: string;
  committerEmail: string;
  syncTtlMs: number;
  authCacheTtlMs: number;
  maxBodyBytes: number;
  maxImageBytes: number;
  pythonBin: string;
  previewScript: string;
};

function need(env: Record<string, string | undefined>, name: string): string {
  const value = (env[name] ?? "").trim();
  if (!value) throw new Error(`Missing required setting ${name} (see .env.example)`);
  return value;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const dataDir = path.resolve(/* turbopackIgnore: true */ env.DATA_DIR ?? "/data");
  fs.mkdirSync(dataDir, { recursive: true });

  let secret = (env.SECRET_KEY ?? "").trim();
  if (!secret) {
    const keyFile = path.join(/* turbopackIgnore: true */ dataDir, "secret_key");
    if (fs.existsSync(keyFile)) secret = fs.readFileSync(keyFile, "utf8").trim();
    else {
      secret = crypto.randomBytes(32).toString("hex");
      fs.writeFileSync(keyFile, secret, { mode: 0o600 });
    }
  }

  const siteDir = (env.SITE_DIR ?? "").trim() ? path.resolve(/* turbopackIgnore: true */ env.SITE_DIR!.trim()) : "";

  const publicUrl = need(env, "PUBLIC_URL").replace(/\/+$/, "");
  if (!/^https?:\/\//.test(publicUrl)) throw new Error("PUBLIC_URL must start with http:// or https://");

  return {
    dataDir,
    siteDir,
    repoUrl: siteDir ? "" : need(env, "REPO_URL"),
    repoBranch: (env.REPO_BRANCH ?? "main").trim(),
    gitSshCommand: (env.GIT_SSH_COMMAND ?? "").trim(),
    publicUrl,
    publicOrigin: new URL(publicUrl).origin,
    authPortalUrl: need(env, "AUTH_PORTAL_URL").replace(/\/+$/, ""),
    autheliaUrl: need(env, "AUTHELIA_URL").replace(/\/+$/, ""),
    guidesSiteUrl: (env.GUIDES_SITE_URL ?? "https://guides.kcc.com").replace(/\/+$/, ""),
    secretKey: secret,
    adminUsers: new Set(
      (env.ADMIN_USERS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)),
    adminGroup: (env.ADMIN_GROUP ?? "IT-Staff").trim(),
    timezone: (env.TIMEZONE ?? "Indian/Maldives").trim(),
    committerName: "KCC Guides Admin",
    committerEmail: "guides-admin@users.noreply.kcc.com",
    syncTtlMs: Number(env.SYNC_TTL_SECONDS ?? 10) * 1000,
    authCacheTtlMs: 20_000,
    maxBodyBytes: 200_000,
    maxImageBytes: 5_000_000,
    pythonBin: env.PYTHON_BIN ?? "python3",
    previewScript: env.PREVIEW_SCRIPT ?? path.resolve(/* turbopackIgnore: true */ process.cwd(), "preview/preview.py"),
  };
}
