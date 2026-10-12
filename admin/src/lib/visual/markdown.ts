/**
 * Visual editor <-> Markdown.
 *
 * The site is built by Python-Markdown plus two custom blocks (`::: callout`,
 * `::: steps`) that the builder pulls out *before* Markdown runs and renders by
 * hand. This module mirrors that: it splits the text the same way the builder
 * does, converts ordinary Markdown with markdown-it <-> prosemirror-markdown,
 * and converts the custom blocks with the builder's own rules.
 *
 * `canRoundTrip` is the safety net: if a guide uses anything the visual editor
 * can't keep exactly (raw HTML, unsupported syntax, ...) it says so and the
 * editor stays in Markdown mode instead of silently rewriting the guide.
 */
import { getSchema } from "@tiptap/core";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import MarkdownIt from "markdown-it";
import { MarkdownParser, MarkdownSerializer, MarkdownSerializerState } from "prosemirror-markdown";
import { editorExtensions } from "./extensions";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// -------------------------------------------------------------- splitting
// Ported from build.py so the editor sees exactly the same blocks the site does.

const CALLOUT_RE = /^::: *callout +(.+?)\s*\n([\s\S]*?)\n::: *$/gm;
const STEPS_RE = /^::: *steps *\n([\s\S]*?)\n::: *$/gm;
const FENCE_SPAN_RE = /(?:^|\n)(`{3,})[^\n]*\n[\s\S]*?\n\1(?=\n|$)/g;
const STEP_ITEM_RE = /^\d+\.\s+\*\*(.+?)\*\*\s*\n((?:(?!^\d+\.\s+\*\*).+\n?)*)/gm;

export type Segment =
  | { kind: "md"; text: string }
  | { kind: "callout"; title: string; body: string; raw: string }
  | { kind: "steps"; raw: string; full: string };

export function splitSegments(md: string): Segment[] {
  const fences: [number, number][] = [];
  for (const m of md.matchAll(FENCE_SPAN_RE)) fences.push([m.index!, m.index! + m[0].length]);
  const inFence = (i: number) => fences.some(([s, e]) => s <= i && i < e);

  const hits: { start: number; end: number; seg: Segment }[] = [];
  for (const m of md.matchAll(CALLOUT_RE)) {
    if (!inFence(m.index!)) {
      hits.push({ start: m.index!, end: m.index! + m[0].length, seg: { kind: "callout", title: m[1], body: m[2], raw: m[0] } });
    }
  }
  for (const m of md.matchAll(STEPS_RE)) {
    if (!inFence(m.index!)) {
      hits.push({ start: m.index!, end: m.index! + m[0].length, seg: { kind: "steps", raw: m[1], full: m[0] } });
    }
  }
  hits.sort((a, b) => a.start - b.start);

  const out: Segment[] = [];
  let pos = 0;
  for (const h of hits) {
    if (h.start < pos) continue; // overlapping match: leave to Markdown
    out.push({ kind: "md", text: md.slice(pos, h.start) });
    out.push(h.seg);
    pos = h.end;
  }
  out.push({ kind: "md", text: md.slice(pos) });
  return out;
}

// ---------------------------------------------------- custom block parsing

const decodeEntities = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/** Text with `code` chips -> editor inline nodes. Returns null if it holds anything we can't keep. */
function inlineRuns(text: string): Json[] | null {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.includes("<")) return null; // raw "<" could be a real HTML tag on the site
  const runs: Json[] = [];
  let last = 0;
  for (const m of flat.matchAll(/`([^`]+)`/g)) {
    if (m.index! > last) runs.push({ type: "text", text: decodeEntities(flat.slice(last, m.index)) });
    runs.push({ type: "text", text: decodeEntities(m[1]), marks: [{ type: "code" }] });
    last = m.index! + m[0].length;
  }
  if (last < flat.length) runs.push({ type: "text", text: decodeEntities(flat.slice(last)) });
  return runs.filter((r) => r.text);
}

function plainRuns(text: string): Json[] | null {
  const runs = inlineRuns(text);
  if (!runs || runs.some((r) => r.marks)) return null; // titles are plain text
  return runs;
}

const calloutNode = (title: Json[], body: Json[]): Json => ({
  type: "callout",
  content: [{ type: "calloutTitle", content: title }, { type: "calloutBody", content: body }],
});

function parseSteps(raw: string): Json | null {
  const block = raw.trim() + "\n";
  const items: Json[] = [];
  for (const m of block.matchAll(STEP_ITEM_RE)) {
    const title = plainRuns(m[1].trim());
    const body = inlineRuns(m[2].trim().split("\n").map((l) => l.trim()).filter(Boolean).join(" "));
    if (!title || !body) return null;
    items.push({
      type: "step",
      content: [{ type: "stepTitle", content: title }, { type: "stepBody", content: body }],
    });
  }
  // Anything the site's builder would silently drop is something we must not drop either.
  if (!items.length || block.replace(STEP_ITEM_RE, "").trim()) return null;
  return { type: "steps", content: items };
}

// ------------------------------------------------------------- markdown-it

function newMarkdownIt(): InstanceType<typeof MarkdownIt> {
  // Python-Markdown (what the site uses) has no tables or ~~strike-through~~.
  return new MarkdownIt("default", { html: true, linkify: false, typographer: false })
    .disable(["table", "strikethrough"]);
}

let schemaCache: Schema | null = null;
export function getEditorSchema(): Schema {
  return (schemaCache ??= getSchema(editorExtensions()));
}

let parserCache: MarkdownParser | null = null;
function parser(): MarkdownParser {
  if (parserCache) return parserCache;
  const p = new MarkdownParser(getEditorSchema(), newMarkdownIt(), {
    blockquote: { block: "blockquote" },
    paragraph: { block: "paragraph" },
    list_item: { block: "listItem" },
    bullet_list: { block: "bulletList" },
    ordered_list: { block: "orderedList", getAttrs: (tok) => ({ start: +(tok.attrGet("start") || 1) }) },
    heading: { block: "heading", getAttrs: (tok) => ({ level: +tok.tag.slice(1) }) },
    code_block: { block: "codeBlock", noCloseToken: true },
    fence: {
      block: "codeBlock",
      getAttrs: (tok) => ({ language: tok.info.trim().split(/\s+/)[0] || null }),
      noCloseToken: true,
    },
    hr: { node: "horizontalRule" },
    image: {
      node: "image",
      getAttrs: (tok) => ({
        src: tok.attrGet("src"),
        title: tok.attrGet("title") || null,
        alt: (tok.children && tok.children[0] && tok.children[0].content) || null,
      }),
    },
    hardbreak: { node: "hardBreak" },
    em: { mark: "italic" },
    strong: { mark: "bold" },
    link: { mark: "link", getAttrs: (tok) => ({ href: tok.attrGet("href"), title: tok.attrGet("title") || null }) },
    code_inline: { mark: "code", noCloseToken: true },
  });
  // A line break inside a paragraph is just a space on the published page.
  (p as unknown as { tokenHandlers: Record<string, (state: { addText(t: string): void }) => void> })
    .tokenHandlers.softbreak = (state) => state.addText(" ");
  return (parserCache = p);
}

const hasHtmlTokens = (tokens: { type: string; children?: unknown }[]): boolean =>
  tokens.some((t) =>
    t.type === "html_block" || t.type === "html_inline" ||
    (Array.isArray(t.children) && hasHtmlTokens(t.children)));

// ------------------------------------------------------------------ parse

/** Markdown (the guide body) -> editor document JSON. Throws if something can't be represented. */
export function markdownToDoc(md: string): Json {
  const content: Json[] = [];
  for (const seg of splitSegments(md)) {
    if (seg.kind === "md") {
      if (!seg.text.trim()) continue;
      const doc = parser().parse(seg.text);
      for (const child of (doc.toJSON().content ?? []) as Json[]) content.push(child);
    } else if (seg.kind === "callout") {
      const title = plainRuns(seg.title);
      const body = inlineRuns(seg.body.trim());
      if (!title || !body) throw new Error("callout text can't be represented");
      content.push(calloutNode(title, body));
    } else {
      const steps = parseSteps(seg.raw);
      if (!steps) throw new Error("steps block can't be represented");
      content.push(steps);
    }
  }
  if (!content.length) content.push({ type: "paragraph" });
  return { type: "doc", content };
}

// -------------------------------------------------------------- serialize

/**
 * Escaping tuned for Python-Markdown. prosemirror-markdown's default also
 * escapes `~`, which Python-Markdown would show as a literal backslash.
 */
let afterBreak = false; // the next text starts a new line (after a hard break)
function esc(this: unknown, str: string, startOfLine = false): string {
  startOfLine = startOfLine || afterBreak;
  afterBreak = false;
  let s = str.replace(/[\\`*_[\]]/g, (m) => "\\" + m);
  s = s.replace(/&(?=#?\w+;)/g, "&amp;").replace(/</g, "&lt;");
  if (startOfLine) {
    s = s
      .replace(/^(\s*)([-+>])/, "$1\\$2")
      .replace(/^(\s*)#/, "$1\\#") // Python-Markdown makes "#text" a heading even without a space
      .replace(/^(\s*\d+)\.(\s|$)/, "$1\\.$2")
      .replace(/^(\s*)=/, "$1&#61;")
      .replace(/^(\s*):::/, "$1&#58;::");
  }
  return s;
}
(MarkdownSerializerState.prototype as unknown as { esc: typeof esc }).esc = esc;

const urlSafe = (u: string) => u.replace(/\s/g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");

function ticksFor(text: string): string {
  const used = new Set((text.match(/`+/g) ?? []).map((r) => r.length));
  let n = 1;
  while (used.has(n)) n++;
  return "`".repeat(n);
}

const fence = (text: string) => {
  let ticks = "```";
  while (text.includes(ticks)) ticks += "`";
  return ticks;
};

/** Inline text of a callout/step part, written the way the site's builder reads it. */
function customInline(node: PMNode): string {
  let out = "";
  node.forEach((child) => {
    let t = (child.text ?? "").replace(/\s+/g, " ");
    if (child.marks.some((m) => m.type.name === "code")) {
      out += "`" + t.replace(/`/g, "'") + "`";
    } else {
      t = t.replace(/`/g, "'").replace(/&(?=#?\w+;)/g, "&amp;").replace(/</g, "&lt;");
      out += t;
    }
  });
  return out.trim();
}

const plainTitle = (node: PMNode) =>
  customInline(node).replace(/`/g, "").replace(/\*\*/g, "*").replace(/\s+/g, " ").trim();

let serializerCache: MarkdownSerializer | null = null;
function serializer(): MarkdownSerializer {
  if (serializerCache) return serializerCache;
  serializerCache = new MarkdownSerializer(
    {
      text(state, node) {
        state.text(node.text ?? "");
      },
      paragraph(state, node) {
        if (!node.childCount) return;
        state.renderInline(node);
        state.closeBlock(node);
      },
      heading(state, node) {
        state.write("#".repeat(Math.min(6, Math.max(1, node.attrs.level))) + " ");
        state.renderInline(node, false);
        state.closeBlock(node);
      },
      blockquote(state, node) {
        state.wrapBlock("> ", null, node, () => state.renderContent(node));
      },
      codeBlock(state, node) {
        const text = node.textContent;
        const ticks = fence(text);
        state.write(ticks + (node.attrs.language || "") + "\n");
        state.text(text, false);
        state.ensureNewLine();
        state.write(ticks);
        state.closeBlock(node);
      },
      horizontalRule(state, node) {
        state.write("---");
        state.closeBlock(node);
      },
      bulletList(state, node) {
        state.renderList(node, "    ", () => "- ");
      },
      orderedList(state, node) {
        const start = node.attrs.start ?? 1;
        state.renderList(node, "    ", (i) => `${start + i}. `);
      },
      listItem(state, node) {
        state.renderContent(node);
      },
      image(state, node) {
        const src = String(node.attrs.src ?? "");
        if (!src || src.startsWith("data:")) return; // never store pasted data: URLs
        const alt = state.esc(node.attrs.alt || "");
        const title = node.attrs.title ? ` "${String(node.attrs.title).replace(/"/g, "&quot;")}"` : "";
        state.write(`![${alt}](${urlSafe(src)}${title})`);
      },
      hardBreak(state, node, parent, index) {
        for (let i = index + 1; i < parent.childCount; i++) {
          if (parent.child(i).type !== node.type) {
            state.write("  \n");
            afterBreak = true;
            return;
          }
        }
      },
      callout(state, node) {
        const title = plainTitle(node.child(0)) || "Note";
        state.write(`::: callout ${title}\n${customInline(node.child(1))}\n:::`);
        state.closeBlock(node);
      },
      steps(state, node) {
        const lines: string[] = ["::: steps"];
        node.forEach((step, _off, i) => {
          if (i) lines.push("");
          lines.push(`${i + 1}. **${plainTitle(step.child(0)) || "Step"}**`);
          const body = customInline(step.child(1));
          if (body) lines.push(`   ${body}`);
        });
        lines.push(":::");
        state.write(lines.join("\n"));
        state.closeBlock(node);
      },
    },
    {
      bold: { open: "**", close: "**", mixable: true, expelEnclosingWhitespace: true },
      italic: { open: "*", close: "*", mixable: true, expelEnclosingWhitespace: true },
      code: {
        open(_s, _m, parent, index) {
          const t = parent.child(index).text ?? "";
          return ticksFor(t) + (t.startsWith("`") ? " " : "");
        },
        close(_s, _m, parent, index) {
          const t = parent.child(index - 1).text ?? "";
          return (t.endsWith("`") ? " " : "") + ticksFor(t);
        },
        escape: false,
      },
      link: {
        open: "[",
        close(_s, mark) {
          const title = mark.attrs.title ? ` "${String(mark.attrs.title).replace(/"/g, "&quot;")}"` : "";
          return `](${urlSafe(String(mark.attrs.href ?? ""))}${title})`;
        },
      },
    },
    { hardBreakNodeName: "hardBreak" },
  );
  return serializerCache;
}

/** Editor document -> Markdown (guide body). */
export function docToMarkdown(doc: PMNode | Json): string {
  const schema = getEditorSchema();
  const node = "toJSON" in doc && typeof doc.toJSON === "function" ? (doc as PMNode) : schema.nodeFromJSON(doc);
  const parts: string[] = [];
  let run: PMNode[] = [];
  const flush = () => {
    if (!run.length) return;
    const text = serializer()
      .serialize(schema.topNodeType.create(null, run), { tightLists: true })
      .trim();
    if (text) parts.push(text);
    run = [];
  };
  node.forEach((child) => {
    if (child.type.name === "callout" || child.type.name === "steps") {
      flush();
      parts.push(serializer().serialize(schema.topNodeType.create(null, [child])).trim());
    } else run.push(child);
  });
  flush();
  return parts.length ? parts.join("\n\n") + "\n" : "";
}

// -------------------------------------------------------------- round trip

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const canon = (runs: Json[]) => runs.map((r) => (r.marks ? "`" + r.text + "`" : r.text)).join("");

/** What the *meaning* of a body is, ignoring formatting-only differences. */
function fingerprint(md: string): string[] {
  const mi = newMarkdownIt();
  return splitSegments(md).flatMap((seg) => {
    if (seg.kind === "md") return seg.text.trim() ? [norm(mi.render(seg.text))] : [];
    if (seg.kind === "callout") {
      const t = plainRuns(seg.title);
      const b = inlineRuns(seg.body.trim());
      if (!t || !b) throw new Error("callout text can't be represented");
      return [`callout|${canon(t)}|${canon(b)}`];
    }
    const steps = parseSteps(seg.raw);
    if (!steps) throw new Error("steps block can't be represented");
    return ["steps|" + (steps.content as Json[]).map((st) =>
      canon(st.content[0].content) + "=" + canon(st.content[1].content)).join("||")];
  });
}

export type Fidelity = { ok: true } | { ok: false; reason: string };

/**
 * Can this body be opened in the visual editor and saved back with the same
 * meaning? If not, say why (shown to the editor, who stays in Markdown mode).
 */
export function canRoundTrip(md: string): Fidelity {
  try {
    const mi = newMarkdownIt();
    for (const seg of splitSegments(md)) {
      if (seg.kind === "md" && hasHtmlTokens(mi.parse(seg.text, {}))) {
        return { ok: false, reason: "it contains raw HTML" };
      }
    }
    const back = docToMarkdown(markdownToDoc(md));
    const a = fingerprint(md);
    const b = fingerprint(back);
    if (a.length !== b.length || a.some((x, i) => x !== b[i])) {
      return { ok: false, reason: "it uses formatting the visual editor can't keep exactly" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `it uses formatting the visual editor doesn't support (${(err as Error).message})` };
  }
}

// ------------------------------------------------- keep untouched text as-is

function splitMdBlocks(text: string): string[] {
  const blocks: string[] = [];
  let cur: string[] = [];
  let fenceLen = 0;
  const flush = () => { if (cur.length) blocks.push(cur.join("\n")); cur = []; };
  for (const line of text.split("\n")) {
    const m = /^(`{3,})/.exec(line);
    if (fenceLen) {
      cur.push(line);
      if (m && m[1].length >= fenceLen && line.trim() === m[1]) { fenceLen = 0; flush(); }
      continue;
    }
    if (m) { flush(); fenceLen = m[1].length; cur.push(line); continue; }
    if (!line.trim()) { flush(); continue; }
    cur.push(line);
  }
  flush();
  return blocks;
}

function splitBlocks(md: string): string[] {
  return splitSegments(md).flatMap((seg) =>
    seg.kind === "md" ? splitMdBlocks(seg.text) : [seg.kind === "callout" ? seg.raw : seg.full]);
}

function blockPrint(block: string): string {
  try {
    return fingerprint(block).join("||");
  } catch {
    return "raw:" + block;
  }
}

/**
 * The visual editor re-writes everything it saves. To keep GitHub history
 * readable, any block of `next` that means the same as a block of `original`
 * keeps the original wording/line-wrapping; only blocks that really changed
 * are written fresh.
 */
export function preserveOriginal(original: string, next: string): string {
  const pool = new Map<string, string[]>();
  for (const block of splitBlocks(original)) {
    const key = blockPrint(block);
    pool.set(key, [...(pool.get(key) ?? []), block]);
  }
  const out = splitBlocks(next).map((block) => {
    const queue = pool.get(blockPrint(block));
    return queue && queue.length ? queue.shift()! : block;
  });
  return out.length ? out.join("\n\n") + "\n" : "";
}
