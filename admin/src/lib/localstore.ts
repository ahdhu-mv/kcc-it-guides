/**
 * Guides stored as plain files in the site's own project folder (no GitHub).
 *
 * The admin app is given the site project (build.py, templates, config/,
 * content/, ...). It only ever changes `content/` and `config/`. Because there
 * is no git history here, every change is kept: the OLD version of each file
 * it touched goes to data/history/<time>-<who>/ together with a short list of
 * what changed, so a mistake can be undone by copying the old file back.
 *
 * One lock, one change at a time. If a change fails half-way, everything it
 * touched is put back exactly as it was. One app instance only.
 */
import fs from "node:fs";
import path from "node:path";
import { Mutex, type GuideStore } from "./repo";

export type LocalStoreOptions = { dir: string; historyDir: string; keepHistory: number };

/** The only places the app may change, relative to the site folder. */
const TRACKED = ["content", "config"];

type Snapshot = Map<string, Buffer>;

function walk(root: string, rel: string, out: Snapshot): void {
  const abs = path.join(root, rel);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) walk(root, r, out);
    else if (e.isFile()) out.set(r, fs.readFileSync(path.join(root, r)));
  }
}

function snapshot(root: string): Snapshot {
  const out: Snapshot = new Map();
  for (const t of TRACKED) walk(root, t, out);
  return out;
}

type Change = { kind: "A" | "M" | "D"; file: string };

function diff(before: Snapshot, after: Snapshot): Change[] {
  const changes: Change[] = [];
  for (const [file, data] of after) {
    const old = before.get(file);
    if (!old) changes.push({ kind: "A", file });
    else if (!old.equals(data)) changes.push({ kind: "M", file });
  }
  for (const file of before.keys()) if (!after.has(file)) changes.push({ kind: "D", file });
  return changes.sort((a, b) => a.file.localeCompare(b.file));
}

function writeAtomic(file: string, data: Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export class LocalStore implements GuideStore {
  private mutex = new Mutex();
  constructor(private opts: LocalStoreOptions) {}

  get dir(): string {
    return this.opts.dir;
  }

  async read<T>(fn: (root: string) => T): Promise<T> {
    return this.mutex.run(async () => {
      if (!fs.existsSync(path.join(this.opts.dir, "content")) && !fs.existsSync(path.join(this.opts.dir, "config"))) {
        throw new Error(`The guides folder ${this.opts.dir} has no content/ or config/ (is the site folder mounted?).`);
      }
      return fn(this.opts.dir);
    });
  }

  async publish<T>(
    message: string, author: { name: string; email: string },
    mutate: (root: string) => T | Promise<T>,
  ): Promise<T> {
    return this.mutex.run(async () => {
      const root = this.opts.dir;
      const before = snapshot(root);
      try {
        const result = await mutate(root);
        this.remember(before, snapshot(root), message, author.name);
        return result;
      } catch (err) {
        this.restore(before);
        throw err;
      }
    });
  }

  /** Put every tracked file back exactly as it was in `before`. */
  private restore(before: Snapshot): void {
    const root = this.opts.dir;
    const now = snapshot(root);
    for (const [file, data] of before) {
      const cur = now.get(file);
      if (!cur || !cur.equals(data)) writeAtomic(path.join(root, file), data);
    }
    for (const file of now.keys()) if (!before.has(file)) fs.rmSync(path.join(root, file), { force: true });
  }

  /** Keep the old copy of everything this change touched. A failure here never undoes the change itself. */
  private remember(before: Snapshot, after: Snapshot, message: string, who: string): void {
    const changes = diff(before, after);
    if (!changes.length) return;
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safeWho = who.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40) || "unknown";
      const dir = path.join(this.opts.historyDir, `${stamp}-${safeWho}`);
      fs.mkdirSync(dir, { recursive: true });
      for (const c of changes) {
        const old = before.get(c.file);
        if (old) writeAtomic(path.join(dir, "before", c.file), old);
      }
      const summary = [message.split("\n")[0], `by ${who}`, "", ...changes.map((c) => `${c.kind} ${c.file.split(path.sep).join("/")}`), ""];
      fs.writeFileSync(path.join(dir, "changes.txt"), summary.join("\n"));
      this.prune();
    } catch {
      /* history is best-effort */
    }
  }

  private prune(): void {
    const names = fs.readdirSync(this.opts.historyDir).sort();
    for (const n of names.slice(0, Math.max(0, names.length - this.opts.keepHistory))) {
      fs.rmSync(path.join(this.opts.historyDir, n), { recursive: true, force: true });
    }
  }
}
