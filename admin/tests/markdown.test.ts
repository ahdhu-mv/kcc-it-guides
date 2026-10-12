import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canRoundTrip, docToMarkdown, getEditorSchema, markdownToDoc, preserveOriginal, splitSegments } from "@/lib/visual/markdown";
import { normHtml, pythonHasBuilder, renderWithSite, REPO_ROOT, visibleText } from "./helpers";

const haveSite = pythonHasBuilder();
const siteIt = it.skipIf(!haveSite);

const roundTrip = (md: string) => docToMarkdown(markdownToDoc(md));

function allGuideBodies(): { file: string; body: string }[] {
  const out: { file: string; body: string }[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) {
        const text = fs.readFileSync(p, "utf8");
        const m = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/.exec(text);
        out.push({ file: path.relative(REPO_ROOT, p), body: m ? m[2] : text });
      }
    }
  };
  walk(path.join(REPO_ROOT, "content"));
  return out;
}

describe("splitting matches the site builder", () => {
  it("finds callouts and steps, but not inside code fences", () => {
    const md = "intro\n\n::: callout Hi\nbody `x`\n:::\n\n```markdown\n::: callout Fake\nno\n:::\n```\n\n::: steps\n1. **A**\n   b\n:::\n";
    const kinds = splitSegments(md).map((s) => s.kind);
    expect(kinds).toEqual(["md", "callout", "md", "steps", "md"]);
  });
});

describe("existing guides", () => {
  const guides = allGuideBodies();
  it("there are guides to test", () => expect(guides.length).toBeGreaterThan(3));

  for (const g of guides) {
    siteIt(`${g.file}: opens in the visual editor and publishes identically`, () => {
      const fid = canRoundTrip(g.body);
      if (!fid.ok) {
        // The only acceptable refusal: the guide uses raw HTML, so the editor stays in Markdown mode.
        expect(fid.reason).toContain("raw HTML");
        return;
      }
      const back = roundTrip(g.body);
      const [a, b] = renderWithSite([g.body, back]);
      expect(normHtml(b)).toBe(normHtml(a));
    });
  }

  it("the formatting guide itself is fully supported", () => {
    const g = guides.find((x) => x.file.endsWith("formatting-guides-with-markdown.md"))!;
    const fid = canRoundTrip(g.body);
    expect(fid, JSON.stringify(fid)).toEqual({ ok: true });
  });
});

const CASES: Record<string, string> = {
  paragraphs: "First paragraph.\n\nSecond paragraph with **bold**, *italic* and `code`.\n",
  headings: "## Section\n\nText\n\n### Sub\n\nMore\n",
  bullets: "- one\n- two\n- three\n",
  ordered: "1. one\n2. two\n3. three\n",
  nested: "- a\n    - b\n    - c\n- d\n",
  nestedOrdered: "1. a\n    1. b\n    2. c\n2. d\n",
  code: "```bash\nsudo systemctl restart nginx\necho \"hi\"\n```\n",
  codeWithFence: "````\n```\ninner\n```\n````\n",
  link: "See [the docs](https://example.com/a_b) and [mail](mailto:it@kcc.com).\n",
  linkWithParens: "A [thing](https://example.com/a%28b%29) here.\n",
  image: "![A diagram](../images/build-flow-example.svg)\n",
  rule: "above\n\n---\n\nbelow\n",
  quote: "> quoted text\n> more\n\nafter\n",
  hardBreak: "line one  \nline two\n",
  inlineCodeWithTick: "Use `` a`b `` here.\n",
  boldItalic: "***both*** and **bold *nested italic* bold**\n",
  entitiesAndSymbols: "Fish &amp; chips, 5 &lt; 6, a_b_c, 2 * 3, ~tilde~, #hash, a|b\n",
  literalListLookalike: "\\- not a list\n\n1\\. not a list\n\n\\# not a heading\n\n\\> not a quote\n",
  boldCode: "Use **`ssh-keygen`** or *`ssh`* or [`docs`](https://e.com) or ***`all`***.\n\n- **`item`** — text\n",
  callout: "::: callout Heads up\nDo this `first` thing.\n:::\n",
  steps: "::: steps\n1. **Open the menu**\n   Click the gear icon.\n\n2. **Pick Network**\n   Third item.\n:::\n",
  mixed: "Intro text.\n\n::: callout Before you start\nHave your card ready.\n:::\n\n## Do it\n\n::: steps\n1. **One**\n   First.\n\n2. **Two**\n   Second.\n:::\n\nDone.\n",
  codeExampleOfCustomSyntax: "```markdown\n::: callout Title\nBody\n:::\n```\n",
};

describe("supported formatting round-trips through the visual editor", () => {
  for (const [name, md] of Object.entries(CASES)) {
    siteIt(name, () => {
      expect(canRoundTrip(md), "canRoundTrip").toEqual({ ok: true });
      const back = roundTrip(md);
      const [a, b] = renderWithSite([md, back]);
      expect(normHtml(b)).toBe(normHtml(a));
      // and it is stable: a second trip changes nothing
      expect(roundTrip(back)).toBe(back);
    });
  }
});

describe("things the visual editor refuses to touch", () => {
  const REFUSED: Record<string, string> = {
    rawHtmlBlock: "<details><summary>More</summary>\n\nhidden\n\n</details>\n",
    rawHtmlInline: "Press <kbd>Ctrl</kbd> now.\n",
    calloutWithHtml: "::: callout Careful\nDon't <b>bold</b> this.\n:::\n",
    stepsWithExtraText: "::: steps\nstray intro line\n1. **A**\n   b\n:::\n",
  };
  for (const [name, md] of Object.entries(REFUSED)) {
    it(name, () => expect(canRoundTrip(md).ok).toBe(false));
  }
});

describe("text typed in the editor always comes out as typed", () => {
  const TOKENS = ["*", "_", "`", "~", "<", "&", "&lt;", ">", "#", "-", "+", "1.", "[", "]", "(", ")", "!", "\\", ":::", "=", "|", "a", "b", "x y", " "];
  const rand = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

  siteIt("random tricky paragraphs (and lines after a line break) survive the trip", () => {
    const schema = getEditorSchema();
    const bad: string[] = [];
    for (const seed of [42, 7, 99, 2026, 31337]) {
      const r = rand(seed);
      const phrase = () => {
        const n = 1 + Math.floor(r() * 5);
        let t = "";
        for (let j = 0; j < n; j++) t += TOKENS[Math.floor(r() * TOKENS.length)] + (r() < 0.4 ? " " : "");
        return t.replace(/\s+/g, " ").trim();
      };
      const docs: { json: object; expected: string }[] = [];
      for (let i = 0; i < 250; i++) {
        const first = phrase();
        if (!first) continue;
        if (r() < 0.3) {
          const second = phrase();
          if (!second) continue;
          docs.push({
            expected: `${first} ${second}`,
            json: { type: "doc", content: [{ type: "paragraph", content: [
              { type: "text", text: first }, { type: "hardBreak" }, { type: "text", text: second }] }] },
          });
        } else {
          docs.push({ expected: first, json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: first }] }] } });
        }
      }
      const mds = docs.map((d) => docToMarkdown(schema.nodeFromJSON(d.json)));
      const html = renderWithSite(mds);
      docs.forEach((d, i) => {
        if (visibleText(html[i]) !== d.expected) {
          bad.push(`typed ${JSON.stringify(d.expected)} -> md ${JSON.stringify(mds[i])} -> shows ${JSON.stringify(visibleText(html[i]))}`);
        }
      });
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  siteIt("tricky text inside lists, headings and links", () => {
    const schema = getEditorSchema();
    const t = "a_b *c* ~d~ <e> & 1. f";
    const textNode = (text: string, marks?: object[]) => ({ type: "text", text, ...(marks ? { marks } : {}) });
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [textNode(t)] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [textNode(t)] }] }] },
        { type: "paragraph", content: [textNode(t, [{ type: "link", attrs: { href: "https://e.com/a b(c)" } }])] },
      ],
    });
    const md = docToMarkdown(doc);
    const [html] = renderWithSite([md]);
    expect(html).toContain("<h2");
    expect((html.match(/a_b \*c\* ~d~ &lt;e&gt; &amp; 1\. f/g) ?? []).length).toBe(3);
    expect(html).toContain('href="https://e.com/a%20b%28c%29"');
  });
});

describe("saving from the visual editor keeps untouched text exactly as it was", () => {
  const ORIGINAL = [
    "Key-based login replaces typing a password with a key pair: a private",
    "key that stays on your own machine, and a public key you place on the",
    "server.",
    "",
    "## Generate a key pair",
    "",
    "::: steps",
    "1. **Run ssh-keygen**",
    "   `ssh-keygen -t ed25519` — Ed25519 is the",
    "   modern algorithm.",
    "",
    "2. **Accept the default**",
    "   Press Enter.",
    ":::",
    "",
    "* old style bullet",
    "* second",
    "",
    "```bash",
    "echo one",
    "",
    "echo two",
    "```",
    "",
  ].join("\n");

  it("only the edited paragraph changes", () => {
    const doc = markdownToDoc(ORIGINAL);
    doc.content[0].content[0].text = "Key-based login is great: a private key stays on your machine.";
    const result = preserveOriginal(ORIGINAL, docToMarkdown(doc));
    const origBlocks = ORIGINAL.split("\n\n").slice(1);
    for (const b of origBlocks) expect(result).toContain(b.trim());
    expect(result.startsWith("Key-based login is great")).toBe(true);
    expect(result).toContain("* old style bullet\n* second");
  });

  siteIt("and the published page is the same as without the preservation", () => {
    const doc = markdownToDoc(ORIGINAL);
    doc.content[0].content[0].text = "A new first paragraph.";
    const plain = docToMarkdown(doc);
    const kept = preserveOriginal(ORIGINAL, plain);
    const [a, b] = renderWithSite([plain, kept]);
    expect(normHtml(b)).toBe(normHtml(a));
  });

  it("nothing edited means nothing rewritten", () => {
    const result = preserveOriginal(ORIGINAL, docToMarkdown(markdownToDoc(ORIGINAL)));
    expect(result.trim()).toBe(ORIGINAL.trim());
  });
});
