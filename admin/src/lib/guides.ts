/**
 * Reading and writing guide files and categories.yaml inside the clone.
 *
 * Everything that touches a path goes through here, so path safety lives in
 * one place: a category or guide name is only used after it matches a strict
 * pattern, and the final path is checked to still be inside content/.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { Conflict, ValidationError } from "./errors";

export { Conflict, ValidationError };

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
export const RESERVED_SLUGS = new Set([
  "images", "general", "assets", "config", "admin", "templates", "dist",
  "deploy", "static", "api", "d", "c", "img", "healthz", "help",
]);
export const GENERAL = "general"; // guides placed directly in content/ (no category folder)
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

export const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml",
};

export type Category = { slug: string; name: string; color: string };
export type GuideSummary = {
  slug: string; title: string; description: string; updated: string; broken: boolean;
};
export type GuideFile = {
  slug: string; meta: Record<string, unknown>; title: string; description: string; body: string; hash: string;
};

// ------------------------------------------------------------------ names

export function slugify(text: string, maxLen = 60): string {
  let t = text.normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase();
  t = t.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  t = t.slice(0, maxLen).replace(/^-+|-+$/g, "");
  return t || "guide";
}

export function checkSlug(slug: string, what = "name"): string {
  if (!SLUG_RE.test(slug ?? "")) {
    throw new ValidationError(
      `The ${what} may only use lowercase letters, numbers and hyphens (max 60 characters).`);
  }
  return slug;
}

export function checkTitle(title: string): string {
  const t = (title ?? "").trim();
  if (!t) throw new ValidationError("Please give the guide a title.");
  if (t.length > 120) throw new ValidationError("The title is too long (maximum 120 characters).");
  if (CONTROL_RE.test(t) || /[\r\n]/.test(t)) {
    throw new ValidationError("The title can't contain line breaks or control characters.");
  }
  return t;
}

export function checkDescription(desc: string): string {
  const d = (desc ?? "").replace(/\s+/g, " ").trim();
  if (d.length > 300) throw new ValidationError("The description is too long (maximum 300 characters).");
  if (CONTROL_RE.test(d)) throw new ValidationError("The description contains characters that aren't allowed.");
  return d;
}

export function checkBody(body: string, maxBytes: number): string {
  const b = (body ?? "").replace(/\r\n?/g, "\n");
  if (b.includes("\0")) throw new ValidationError("The text contains characters that aren't allowed.");
  if (Buffer.byteLength(b, "utf8") > maxBytes) {
    throw new ValidationError(`The guide is too long (maximum ${Math.floor(maxBytes / 1000)} KB of text).`);
  }
  return b.replace(/\n+$/, "") + "\n";
}

export function checkDisplayName(name: string | null | undefined): string {
  const n = (name ?? "").replace(/\s+/g, " ").trim();
  if (!n || n.length > 60) throw new ValidationError("Please enter a name (up to 60 characters).");
  if (CONTROL_RE.test(n)) throw new ValidationError("The name contains characters that aren't allowed.");
  return n;
}

export function checkColor(color: string | null | undefined): string {
  const c = (color ?? "").trim();
  if (!COLOR_RE.test(c)) throw new ValidationError("Pick a colour in the form #rrggbb.");
  return c.toLowerCase();
}

/** Today's date in the configured time zone, as YYYY-MM-DD. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

// ------------------------------------------------------------- categories

const categoriesPath = (root: string) => path.join(root, "config", "categories.yaml");

export function loadCategories(root: string): Category[] {
  const file = categoriesPath(root);
  if (!fs.existsSync(file)) return [];
  const data = YAML.parse(fs.readFileSync(file, "utf8")) ?? [];
  const out: Category[] = [];
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item && typeof item === "object" && item.slug) {
        out.push({
          slug: String(item.slug),
          name: String(item.name ?? item.slug),
          color: String(item.color ?? "#7c8a94"),
        });
      }
    }
  }
  return out;
}

export function categoryMap(root: string): Record<string, Category> {
  const cats: Record<string, Category> = {};
  for (const c of loadCategories(root)) cats[c.slug] = c;
  cats[GENERAL] = { slug: GENERAL, name: "General (site-wide)", color: "#7c8a94" };
  return cats;
}

const block = (slug: string, name: string, color: string) =>
  `- slug: ${slug}\n  name: ${JSON.stringify(name)}\n  color: "${color}"\n`;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const blockRe = (slug: string) =>
  new RegExp(`^- slug: ${escapeRe(slug)}[ \\t]*\\n[\\s\\S]*?(?=^- slug:|(?![\\s\\S]))`, "m");

export function addCategory(root: string, slug: string, name: string, color: string): void {
  checkSlug(slug, "category folder name");
  if (RESERVED_SLUGS.has(slug)) {
    throw new ValidationError(`"${slug}" is reserved. Please choose another folder name.`);
  }
  const file = categoriesPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (loadCategories(root).some((c) => c.slug === slug)) {
    throw new ValidationError("That category already exists.");
  }
  if (text && !text.endsWith("\n")) text += "\n";
  if (text && !text.endsWith("\n\n")) text += "\n";
  fs.writeFileSync(file, text + block(slug, name, color), "utf8");
}

export function updateCategory(root: string, slug: string, name: string, color: string): void {
  const file = categoriesPath(root);
  const text = fs.readFileSync(file, "utf8");
  const match = blockRe(slug).exec(text);
  if (!match) throw new ValidationError("That category isn't in categories.yaml.");
  let replacement = block(slug, name, color);
  if (match[0].endsWith("\n\n")) replacement += "\n";
  fs.writeFileSync(file, text.slice(0, match.index) + replacement + text.slice(match.index + match[0].length), "utf8");
}

// ----------------------------------------------------------------- guides

function dirFor(root: string, category: string): string {
  const content = path.resolve(root, "content");
  if (category === GENERAL) return content;
  checkSlug(category, "category");
  const target = path.resolve(content, category);
  if (path.dirname(target) !== content) throw new ValidationError("Invalid category.");
  return target;
}

function fileFor(root: string, category: string, slug: string): string {
  checkSlug(slug, "guide address");
  const dir = dirFor(root, category);
  const target = path.resolve(dir, `${slug}.md`);
  if (path.dirname(target) !== dir) throw new ValidationError("Invalid guide name.");
  return target;
}

export function parseGuide(text: string): { meta: Record<string, unknown> | null; body: string } {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return { meta: null, body: text };
  try {
    const meta = YAML.parse(m[1]) ?? {};
    if (typeof meta !== "object" || Array.isArray(meta)) return { meta: null, body: text };
    return { meta, body: m[2] };
  } catch {
    return { meta: null, body: text };
  }
}

const fmtDate = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "");

export function listGuides(root: string, category: string): GuideSummary[] {
  const dir = dirFor(root, category);
  if (!fs.existsSync(dir)) return [];
  const out: GuideSummary[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".md") || !fs.statSync(path.join(dir, name)).isFile()) continue;
    const slug = name.slice(0, -3);
    const { meta } = parseGuide(fs.readFileSync(path.join(dir, name), "utf8"));
    const m = meta ?? {};
    out.push({
      slug,
      title: String(m.title || slug),
      description: String(m.description || ""),
      updated: fmtDate(m.updated),
      broken: !meta,
    });
  }
  out.sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
  return out;
}

export function readGuide(root: string, category: string, slug: string): GuideFile | null {
  const file = fileFor(root, category, slug);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  const raw = fs.readFileSync(file);
  const text = raw.toString("utf8");
  const parsed = parseGuide(text);
  const meta = parsed.meta ?? {};
  return {
    slug, meta,
    title: String(meta.title || slug),
    description: String(meta.description || ""),
    body: parsed.meta ? parsed.body : text,
    hash: crypto.createHash("sha256").update(raw).digest("hex"),
  };
}

export function composeGuide(
  extra: Record<string, unknown>, title: string, description: string, body: string, today: string,
): string {
  const meta: Record<string, unknown> = { title, description, updated: today };
  for (const [k, v] of Object.entries(extra ?? {})) if (!(k in meta)) meta[k] = v;
  const front = YAML.stringify(meta, { lineWidth: 0 }).replace(/\n+$/, "");
  return `---\n${front}\n---\n\n${body.replace(/^\n+/, "")}`;
}

export function writeGuide(
  root: string, category: string, slug: string,
  f: { title: string; description: string; body: string; today: string; maxBytes: number },
  opts: { create: boolean; baseHash?: string; force?: boolean },
): string {
  const title = checkTitle(f.title);
  const description = checkDescription(f.description);
  const body = checkBody(f.body, f.maxBytes);
  const file = fileFor(root, category, slug);
  let extra: Record<string, unknown> = {};
  if (opts.create) {
    if (fs.existsSync(file)) {
      throw new ValidationError("A guide with that address already exists in this category.");
    }
  } else {
    const current = readGuide(root, category, slug);
    if (!current) throw new ValidationError("That guide no longer exists (someone may have deleted it).");
    if (opts.baseHash && current.hash !== opts.baseHash && !opts.force) {
      throw new Conflict("This guide was changed by someone else while you were editing it.");
    }
    extra = current.meta;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, composeGuide(extra, title, description, body, f.today), "utf8");
  return title;
}

export function deleteGuide(root: string, category: string, slug: string): string {
  const current = readGuide(root, category, slug);
  if (!current) throw new ValidationError("That guide no longer exists.");
  fs.unlinkSync(fileFor(root, category, slug));
  return current.title;
}

// ----------------------------------------------------------------- images

export function sniffImage(data: Buffer): string | null {
  const starts = (magic: number[]) => magic.every((b, i) => data[i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (starts([0xff, 0xd8, 0xff])) return "jpg";
  if (starts([0x47, 0x49, 0x46, 0x38])) return "gif";
  if (starts([0x52, 0x49, 0x46, 0x46]) && data.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  return null;
}

/** Store an uploaded picture; returns its path relative to content/images/. */
export function saveImage(
  root: string, category: string, originalName: string, data: Buffer, maxBytes: number,
): string {
  let folder = GENERAL;
  if (category !== GENERAL) folder = checkSlug(category, "category");
  if (!data.length) throw new ValidationError("That file is empty.");
  if (data.length > maxBytes) {
    throw new ValidationError(`That picture is too large (maximum ${Math.floor(maxBytes / 1_000_000)} MB).`);
  }
  const ext = sniffImage(data);
  if (!ext) throw new ValidationError("Only PNG, JPEG, GIF and WebP pictures can be uploaded.");
  const stem = slugify(path.parse(originalName || "image").name, 40);
  const images = path.resolve(root, "content", "images");
  const targetDir = path.resolve(images, folder);
  if (path.dirname(targetDir) !== images) throw new ValidationError("Invalid category.");
  fs.mkdirSync(targetDir, { recursive: true });
  let name = `${stem}.${ext}`;
  for (let n = 2; fs.existsSync(path.join(targetDir, name)); n++) name = `${stem}-${n}.${ext}`;
  fs.writeFileSync(path.join(targetDir, name), data);
  return `${folder}/${name}`;
}

/** Resolve an image path (as stored: category/file.ext) safely, or null. */
export function imagePath(root: string, rel: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)+$/.test(rel) || rel.includes("..")) return null;
  const images = path.resolve(root, "content", "images");
  const target = path.resolve(images, rel);
  if (!target.startsWith(images + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return null;
  return target;
}
