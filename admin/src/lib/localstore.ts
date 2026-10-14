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

/**
 * Small files are held in memory. Big ones (attachments, pictures) are not read at all:
 * they are recorded by size and time, and a hard link (or copy) keeps the old content
 * safe in content/.keep/ until the change is finished. Big files are only ever added or
 * removed, never edited in place, so a link is a faithful backup.
 */
const SMALL = 1_000_000;
const KEEP = path.join("content", ".keep");

type Entry = { size: number; mtimeMs: number; data?: Buffer; keep?: string };
type Snapshot = Map<string, Entry>;

function walk(root: string, rel: string, out: Snapshot, keepDir: string | null): void {
  const abs = path.join(root, rel);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const r = path.join(rel, e.name);
    if (r === KEEP) continue;
    if (e.isDirectory()) walk(root, r, out, keepDir);
    else if (e.isFile()) {
      const full = path.join(root, r);
      const st = fs.statSync(full);
      if (st.size <= SMALL) {
        out.set(r, { size: st.size, mtimeMs: st.mtimeMs, data: fs.readFileSync(full) });
      } else {
        const entry: Entry = { size: st.size, mtimeMs: st.mtimeMs };
        if (keepDir) {
          const link = path.join(keepDir, r);
          fs.mkdirSync(path.dirname(link), { recursive: true });
          try { fs.linkSync(full, link); } catch { fs.copyFileSync(full, link); }
          entry.keep = link;
        }
        out.set(r, entry);
      }
    }
  }
}

function snapshot(root: string, withKeep = false): Snapshot {
  const out: Snapshot = new Map();
  const keepDir = withKeep ? path.join(root, KEEP) : null;
  if (keepDir) {
    fs.rmSync(keepDir, { recursive: true, force: true }); // leftovers from a crash
    fs.mkdirSync(keepDir, { recursive: true });
  }
  for (const t of TRACKED) walk(root, t, out, keepDir);
  return out;
}

function same(a: Entry, b: Entry): boolean {
  if (a.data && b.data) return a.data.equals(b.data);
  if (a.data || b.data) return false;
  return a.size === b.size && a.mtimeMs === b.mtimeMs;
}

type Change = { kind: "A" | "M" | "D"; file: string };

function diff(before: Snapshot, after: Snapshot): Change[] {
  const changes: Change[] = [];
  for (const [file, entry] of after) {
    const old = before.get(file);
    if (!old) changes.push({ kind: "A", file });
    else if (!same(old, entry)) changes.push({ kind: "M", file });
  }
  for (const file of before.keys()) if (!after.has(file)) changes.push({ kind: "D", file });
  return changes.sort((a, b) => a.file.localeCompare(b.file));
}

/** Write the content of a snapshot entry to `dest` (atomically). */
function put(dest: string, entry: Entry): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  if (entry.data) fs.writeFileSync(tmp, entry.data);
  else if (entry.keep) fs.copyFileSync(entry.keep, tmp);
  else return;
  fs.renameSync(tmp, dest);
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
      const before = snapshot(root, true);
      try {
        const result = await mutate(root);
        this.remember(before, snapshot(root), message, author.name);
        return result;
      } catch (err) {
        this.restore(before);
        throw err;
      } finally {
        fs.rmSync(path.join(root, KEEP), { recursive: true, force: true });
      }
    });
  }

  /** Put every tracked file back exactly as it was in `before`. */
  private restore(before: Snapshot): void {
    const root = this.opts.dir;
    const now = snapshot(root);
    for (const [file, entry] of before) {
      const cur = now.get(file);
      if (!cur || !same(cur, entry)) put(path.join(root, file), entry);
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
        if (old) put(path.join(dir, "before", c.file), old);
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
