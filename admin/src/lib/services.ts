import path from "node:path";
import { loadConfig, type Config } from "./config";
import { Db } from "./db";
import { GitRepo } from "./repo";

export type Services = { cfg: Config; db: Db; repo: GitRepo };

const KEY = Symbol.for("kcc.guides.admin.services");
type G = typeof globalThis & { [KEY]?: Services };

export function createServices(cfg: Config): Services {
  const db = new Db(path.join(/* turbopackIgnore: true */ cfg.dataDir, "admin.db"));
  const repo = new GitRepo({
    dir: path.join(/* turbopackIgnore: true */ cfg.dataDir, "repo"),
    url: cfg.repoUrl,
    branch: cfg.repoBranch,
    sshCommand: cfg.gitSshCommand,
    committerName: cfg.committerName,
    committerEmail: cfg.committerEmail,
    syncTtlMs: cfg.syncTtlMs,
  });
  return { cfg, db, repo };
}

/** One set of services per process (Next may load modules more than once in dev). */
export function getServices(): Services {
  const g = globalThis as G;
  if (!g[KEY]) g[KEY] = createServices(loadConfig());
  return g[KEY]!;
}

export function setServicesForTests(s: Services | undefined): void {
  (globalThis as G)[KEY] = s;
}
