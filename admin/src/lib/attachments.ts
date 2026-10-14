/**
 * Downloadable files attached to guides (PDF, Word, Excel, PowerPoint, text, CSV),
 * stored as content/files/<category>/<name>. Also finds pictures and files that no
 * guide uses any more, so they can be cleaned up.
 *
 * A file is accepted only if its extension is on the list AND its first bytes
 * really look like that kind of file. Macro-enabled Office files are refused.
 */
import fs from "node:fs";
import path from "node:path";
import { checkSlug, GENERAL, slugify, ValidationError } from "./guides";

type Kind = { label: string; mime: string; check: (d: Buffer) => string | null };

const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** Names of the entries in a zip, read from its directory (nothing is unpacked). */
export function zipNames(d: Buffer): string[] | null {
  const min = Math.max(0, d.length - 22 - 65535);
  let eocd = -1;
  for (let i = d.length - 22; i >= min; i--) {
    if (d.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = d.readUInt16LE(eocd + 10);
  let off = d.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let n = 0; n < count; n++) {
    if (off + 46 > d.length || d.readUInt32LE(off) !== 0x02014b50) return null;
    const nameLen = d.readUInt16LE(off + 28), extra = d.readUInt16LE(off + 30), comment = d.readUInt16LE(off + 32);
    if (off + 46 + nameLen > d.length) return null;
    names.push(d.subarray(off + 46, off + 46 + nameLen).toString("utf8"));
    off += 46 + nameLen + extra + comment;
  }
  return names;
}

function ooxml(folder: string, what: string) {
  return (d: Buffer): string | null => {
    const names = d.length > 3 && d.readUInt32LE(0) === 0x04034b50 ? zipNames(d) : null;
    if (!names || !names.includes("[Content_Types].xml") || !names.some((n) => n.startsWith(folder))) {
      return `That doesn't look like a real ${what} file.`;
    }
    if (names.some((n) => /vbaProject\.bin$/i.test(n))) {
      return "Files that contain macros can't be uploaded. Save a copy without macros first.";
    }
    return null;
  };
}
const ole = (what: string) => (d: Buffer): string | null =>
  OLE.every((b, i) => d[i] === b) ? null : `That doesn't look like a real ${what} file.`;

function text(d: Buffer): string | null {
  // Any text encoding is fine (Excel's CSV is often not UTF-8); binary data is not.
  // eslint-disable-next-line no-control-regex
  for (const b of d.subarray(0, 100_000)) if (b === 0 || (b < 9) || (b > 13 && b < 32 && b !== 26 && b !== 27)) {
    return "That doesn't look like a plain text file.";
  }
  return null;
}

export const FILE_KINDS: Record<string, Kind> = {
  pdf: { label: "PDF", mime: "application/pdf", check: (d) => (d.subarray(0, 5).toString("latin1") === "%PDF-" ? null : "That doesn't look like a real PDF.") },
  docx: { label: "Word", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", check: ooxml("word/", "Word") },
  doc: { label: "Word", mime: "application/msword", check: ole("Word") },
  xlsx: { label: "Excel", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", check: ooxml("xl/", "Excel") },
  xls: { label: "Excel", mime: "application/vnd.ms-excel", check: ole("Excel") },
  pptx: { label: "PowerPoint", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", check: ooxml("ppt/", "PowerPoint") },
  ppt: { label: "PowerPoint", mime: "application/vnd.ms-powerpoint", check: ole("PowerPoint") },
  txt: { label: "Text", mime: "text/plain; charset=utf-8", check: text },
  csv: { label: "CSV", mime: "text/csv; charset=utf-8", check: text },
};
export const FILE_TYPES_HELP = "PDF, Word, Excel, PowerPoint, text and CSV files";
export const ACCEPT_ATTR = Object.keys(FILE_KINDS).map((e) => `.${e}`).join(",");

export function humanSize(n: number): string {
  if (n < 1000) return `${n} B`;
  if (n < 1_000_000) return `${Math.round(n / 1000)} KB`;
  return `${(n / 1_000_000).toFixed(1)} MB`;
}

const REL_RE = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*\.[a-z0-9]+$/;

export function saveAttachment(
  root: string, category: string, originalName: string, data: Buffer, maxBytes: number,
): { rel: string; label: string; size: number } {
  const folder = category === GENERAL ? GENERAL : checkSlug(category, "category");
  if (!data.length) throw new ValidationError("That file is empty.");
  if (data.length > maxBytes) {
    throw new ValidationError(`That file is too large (maximum ${Math.floor(maxBytes / 1_000_000)} MB).`);
  }
  const ext = path.extname(originalName || "").slice(1).toLowerCase();
  const kind = FILE_KINDS[ext];
  if (!kind) throw new ValidationError(`Only ${FILE_TYPES_HELP} can be attached.`);
  const problem = kind.check(data);
  if (problem) throw new ValidationError(problem);
  const stem = slugify(path.parse(originalName).name, 50);
  const files = path.resolve(root, "content", "files");
  const dir = path.resolve(files, folder);
  if (path.dirname(dir) !== files) throw new ValidationError("Invalid category.");
  fs.mkdirSync(dir, { recursive: true });
  let name = `${stem}.${ext}`;
  for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `${stem}-${n}.${ext}`;
  fs.writeFileSync(path.join(dir, name), data);
  return { rel: `${folder}/${name}`, label: kind.label, size: data.length };
}

/** Resolve a stored attachment path safely, or null. */
export function attachmentPath(root: string, rel: string): string | null {
  if (!REL_RE.test(rel)) return null;
  const files = path.resolve(root, "content", "files");
  const target = path.resolve(files, rel);
  if (!target.startsWith(files + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return null;
  return target;
}

// ---------------------------------------------------------------- clean-up

export type Stored = {
  kind: "file" | "image"; rel: string; size: number; modified: string; usedBy: string[];
};

function guideFiles(root: string): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  const content = path.join(root, "content");
  const add = (dir: string, prefix: string) => {
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names) {
      if (n.endsWith(".md")) out.push({ id: `${prefix}${n.slice(0, -3)}`, text: fs.readFileSync(path.join(dir, n), "utf8") });
    }
  };
  add(content, "");
  let cats: fs.Dirent[] = [];
  try { cats = fs.readdirSync(content, { withFileTypes: true }); } catch { /* none */ }
  for (const c of cats) if (c.isDirectory() && !["images", "files"].includes(c.name) && !c.name.startsWith(".")) add(path.join(content, c.name), `${c.name}/`);
  return out;
}

/** Every stored picture and attachment, with the guides that mention it. */
export function listStored(root: string): Stored[] {
  const guidesText = guideFiles(root);
  const out: Stored[] = [];
  for (const [kind, sub] of [["file", "files"], ["image", "images"]] as const) {
    const base = path.join(root, "content", sub);
    let cats: fs.Dirent[] = [];
    try { cats = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
    for (const c of cats) {
      if (!c.isDirectory()) continue;
      for (const f of fs.readdirSync(path.join(base, c.name), { withFileTypes: true })) {
        if (!f.isFile()) continue;
        const rel = `${c.name}/${f.name}`;
        const st = fs.statSync(path.join(base, rel));
        const needle = `${sub}/${rel}`;
        out.push({
          kind, rel, size: st.size, modified: st.mtime.toISOString().slice(0, 10),
          usedBy: guidesText.filter((g) => g.text.includes(needle)).map((g) => g.id),
        });
      }
    }
  }
  return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.rel.localeCompare(b.rel));
}

/** Delete one stored file, but only if no guide mentions it right now. */
export function deleteUnused(root: string, kind: "file" | "image", rel: string): void {
  if (!/^[a-z0-9][a-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(rel) || rel.includes("..")) {
    throw new ValidationError("That file name isn't valid.");
  }
  const sub = kind === "file" ? "files" : "images";
  const base = path.resolve(root, "content", sub);
  const target = path.resolve(base, rel);
  if (!target.startsWith(base + path.sep) || !fs.existsSync(target)) throw new ValidationError("That file no longer exists.");
  const item = listStored(root).find((s) => s.kind === kind && s.rel === rel);
  if (item && item.usedBy.length) {
    throw new ValidationError(`It is used by ${item.usedBy.join(", ")}, so it was not deleted.`);
  }
  fs.rmSync(target);
  const dir = path.dirname(target);
  if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
}
