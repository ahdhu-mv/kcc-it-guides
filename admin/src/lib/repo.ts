/**
 * A private working clone of the guides repository, used only by the admin app.
 *
 * Every write follows one recipe, under one lock so two editors can't
 * interleave: fetch -> reset to the remote's latest -> change files -> commit
 * -> push. If anything fails the clone is reset to the remote again, so it
 * never holds a half-finished change. GitHub stays the source of truth.
 * (One app instance only: the lock is in-process.)
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { GitError } from "./errors";

export type RepoOptions = {
  dir: string;
  url: string;
  branch: string;
  sshCommand: string;
  committerName: string;
  committerEmail: string;
  syncTtlMs: number;
};

export class Mutex {
  private tail: Promise<void> = Promise.resolve();
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((r) => (release = r));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/** What the rest of the app needs from wherever the guides are stored. */
export interface GuideStore {
  readonly dir: string;
  read<T>(fn: (root: string) => T, force?: boolean): Promise<T>;
  publish<T>(
    message: string, author: { name: string; email: string },
    mutate: (root: string) => T | Promise<T>,
  ): Promise<T>;
}

export class GitRepo implements GuideStore {
  private mutex = new Mutex();
  private lastSync = 0;

  constructor(private opts: RepoOptions) {}

  get dir(): string {
    return this.opts.dir;
  }

  private git(args: string[], cwd?: string, check = true): Promise<string> {
    const env = {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      HOME: process.env.HOME || path.dirname(this.opts.dir),
      ...(this.opts.sshCommand ? { GIT_SSH_COMMAND: this.opts.sshCommand } : {}),
    };
    return new Promise((resolve, reject) => {
      execFile("git", args, { cwd: cwd ?? this.opts.dir, env, timeout: 90_000, maxBuffer: 20_000_000 },
        (err, stdout, stderr) => {
          if (err && check) {
            const detail = (stderr || stdout || String(err)).trim().slice(0, 400);
            reject(new GitError(`git ${args[0]} failed: ${detail}`));
          } else resolve(stdout);
        });
    });
  }

  private async ensureCloned(): Promise<void> {
    if (fs.existsSync(path.join(this.opts.dir, ".git"))) return;
    fs.mkdirSync(path.dirname(this.opts.dir), { recursive: true });
    await this.git(["clone", "--branch", this.opts.branch, this.opts.url, this.opts.dir],
      path.dirname(this.opts.dir));
  }

  private async resetToRemote(): Promise<void> {
    await this.git(["fetch", "--prune", "origin"]);
    await this.git(["reset", "--hard", `origin/${this.opts.branch}`]);
    await this.git(["clean", "-fdq"]);
    this.lastSync = Date.now();
  }

  /** Read the latest content. `fn` must be quick and synchronous (it runs under the lock). */
  async read<T>(fn: (root: string) => T, force = false): Promise<T> {
    return this.mutex.run(async () => {
      await this.ensureCloned();
      if (force || Date.now() - this.lastSync >= this.opts.syncTtlMs) {
        try {
          await this.resetToRemote();
        } catch (err) {
          // Serve the last good copy if GitHub is briefly unreachable.
          if (this.lastSync === 0) throw err;
        }
      }
      return fn(this.opts.dir);
    });
  }

  /** Apply a change on a fresh copy, commit it as `author`, push. Rolls back on any error. */
  async publish<T>(
    message: string, author: { name: string; email: string },
    mutate: (root: string) => T | Promise<T>,
  ): Promise<T> {
    return this.mutex.run(async () => {
      await this.ensureCloned();
      await this.resetToRemote();
      try {
        const result = await mutate(this.opts.dir);
        await this.commitAndPush(message, author);
        return result;
      } catch (err) {
        await this.resetToRemote().catch(() => undefined);
        throw err;
      }
    });
  }

  private async commitAndPush(message: string, author: { name: string; email: string }): Promise<boolean> {
    const name = author.name.replace(/[<>\r\n\0]/g, "").trim() || "unknown";
    const email = author.email.replace(/[<>\r\n\0 ]/g, "").trim() || "unknown@users.noreply.kcc.com";
    await this.git(["add", "-A"]);
    if (!(await this.git(["status", "--porcelain"])).trim()) return false;
    const identity = ["-c", `user.name=${this.opts.committerName}`, "-c", `user.email=${this.opts.committerEmail}`];
    await this.git([...identity, "commit", "-q", "-m", message, `--author=${name} <${email}>`]);
    const push = () => this.git(["push", "origin", `HEAD:${this.opts.branch}`]);
    try {
      await push();
    } catch {
      // Someone else pushed meanwhile (e.g. an edit on GitHub.com): replay ours on top, once.
      try {
        await this.git(["fetch", "origin"]);
        await this.git([...identity, "rebase", `origin/${this.opts.branch}`]);
        await push();
      } catch (err) {
        await this.git(["rebase", "--abort"], undefined, false);
        throw new GitError(`Could not publish the change: ${(err as Error).message}`);
      }
    }
    return true;
  }
}
