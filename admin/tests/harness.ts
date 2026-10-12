import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { clearAuthCache, csrfToken } from "@/lib/auth";
import { loadConfig } from "@/lib/config";
import { createServices, setServicesForTests, type Services } from "@/lib/services";
import { resetSessionState } from "@/lib/session";
import { PYTHON, REPO_ROOT } from "./helpers";

export const ORIGIN = "https://guides-admin.kcc.com";

const USERS: Record<string, [string, string, string]> = {
  adm: ["a242775", "Ahdhu", "IT-Staff"],
  fin: ["fatima", "Fatima Finance", "Staff"],
  fin2: ["hassan", "Hassan Finance", "Staff"],
  hr: ["hawwa", "Hawwa HR", "Staff"],
  nobody: ["outsider", "Outsider", "Staff"],
};

export function startFakeAuthelia(): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    const m = /authelia_session=([^;]*)/.exec(req.headers.cookie ?? "");
    const token = m ? m[1] : "";
    if (token === "banned") { res.writeHead(403).end(); return; }
    const u = USERS[token];
    if (!u) { res.writeHead(401).end(); return; }
    res.writeHead(200, { "Remote-User": u[0], "Remote-Name": u[1], "Remote-Email": `${u[0]}@kcc.com`, "Remote-Groups": u[2] }).end();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as { port: number }).port;
    resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
  }));
}

const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
export const git = (cwd: string | undefined, ...args: string[]) =>
  execFileSync("git", args, { cwd, env: gitEnv, stdio: "pipe" });

export function makeRemote(tmp: string): string {
  const seed = path.join(tmp, "seed");
  fs.mkdirSync(seed, { recursive: true });
  for (const f of ["build.py", "requirements.txt"]) fs.copyFileSync(path.join(REPO_ROOT, f), path.join(seed, f));
  for (const d of ["templates", "assets"]) fs.cpSync(path.join(REPO_ROOT, d), path.join(seed, d), { recursive: true });
  fs.mkdirSync(path.join(seed, "config"));
  fs.writeFileSync(path.join(seed, "config/categories.yaml"),
    '# categories\n- slug: finance\n  name: Finance\n  color: "#0f6b62"\n\n- slug: hr\n  name: Human resources\n  color: "#b8862f"\n');
  for (const d of ["content/finance", "content/hr", "content/images"]) fs.mkdirSync(path.join(seed, d), { recursive: true });
  fs.writeFileSync(path.join(seed, "content/finance/invoices.md"),
    "---\ntitle: Invoices\ndescription: How to file\nupdated: 2026-01-01\n---\n\nHello.\n");
  git(seed, "init", "-b", "main");
  git(seed, "add", "-A");
  git(seed, "commit", "-m", "seed");
  const bare = path.join(tmp, "remote.git");
  git(undefined, "clone", "--bare", seed, bare);
  return bare;
}

export function showRemote(bare: string, file: string): string | null {
  try {
    return execFileSync("git", ["--git-dir", bare, "show", `main:${file}`], { stdio: "pipe" }).toString("utf8");
  } catch { return null; }
}
export const lastCommit = (bare: string) =>
  execFileSync("git", ["--git-dir", bare, "log", "-1", "--format=%an|%ae|%B"]).toString();

export type World = {
  svc: Services; bare: string; tmp: string; authelia: string;
  as: (who: string | null) => Client;
  cleanup: () => void;
};

export class Client {
  constructor(private who: string | null) {}
  get token(): string { return this.who && USERS[this.who] ? csrfToken("test-secret", USERS[this.who][0]) : ""; }
  headers(extra: Record<string, string> = {}, csrf = true): Record<string, string> {
    return {
      ...(this.who ? { cookie: `authelia_session=${this.who}` } : {}),
      ...(csrf ? { "x-csrf-token": this.token, origin: ORIGIN } : {}),
      ...extra,
    };
  }
  req(method: string, url: string, body?: unknown, opts: { csrf?: boolean; headers?: Record<string, string> } = {}): Request {
    const isForm = body instanceof FormData;
    return new Request(`${ORIGIN}${url}`, {
      method,
      headers: { ...(body !== undefined && !isForm ? { "content-type": "application/json" } : {}),
        ...this.headers(opts.headers, opts.csrf ?? method !== "GET") },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  }
}

/** `local` = guides are plain files in a site folder (no git), like the real docker02 setup. */
export async function makeWorld(local = false): Promise<World> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kcc-admin-"));
  const bare = makeRemote(tmp);
  let siteDir = "";
  if (local) {
    siteDir = path.join(tmp, "site");
    git(undefined, "clone", "-q", bare, siteDir);
    fs.rmSync(path.join(siteDir, ".git"), { recursive: true, force: true });
  }
  const fake = await startFakeAuthelia();
  const cfg = loadConfig({
    DATA_DIR: path.join(tmp, "data"), ...(local ? { SITE_DIR: siteDir } : { REPO_URL: bare }), PUBLIC_URL: ORIGIN, AUTH_PORTAL_URL: "https://auth.kcc.com",
    AUTHELIA_URL: fake.url, ADMIN_USERS: "a242775", SECRET_KEY: "test-secret", SYNC_TTL_SECONDS: "0",
    PYTHON_BIN: PYTHON,
  });
  clearAuthCache();
  resetSessionState();
  const svc = createServices(cfg);
  setServicesForTests(svc);
  return {
    svc, bare, tmp, authelia: fake.url,
    as: (who) => new Client(who),
    cleanup: () => { fake.close(); svc.db.close(); setServicesForTests(undefined); fs.rmSync(tmp, { recursive: true, force: true }); },
  };
}

export const ctx = <P>(params: P) => ({ params: Promise.resolve(params) });
