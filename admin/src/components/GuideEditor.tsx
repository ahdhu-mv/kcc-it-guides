"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { callApi } from "@/lib/client-api";
import { editorExtensions } from "@/lib/visual/extensions";
import { canRoundTrip, docToMarkdown, markdownToDoc, preserveOriginal, type Fidelity } from "@/lib/visual/markdown";
import {
  addStep, insertCallout, insertSteps, insideCustom, leaveCustomBlock, removeEnclosing, removeStep,
} from "@/lib/visual/nodes";

type Props = {
  category: { slug: string; name: string };
  mode: "new" | "edit";
  initial: { title: string; description: string; slug: string; body: string; baseHash: string };
};

type Upload = { path: string; src: string; alt: string; markdown: string };

const slugFromTitle = (t: string) =>
  t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

export function GuideEditor({ category, mode, initial }: Props) {
  const router = useRouter();
  const fidelity = useMemo<Fidelity>(
    () => (initial.body.trim() ? canRoundTrip(initial.body) : { ok: true }), [initial.body]);

  const [view, setView] = useState<"visual" | "markdown">(fidelity.ok ? "visual" : "markdown");
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [slug, setSlug] = useState(initial.slug);
  const [slugTouched, setSlugTouched] = useState(false);
  const [body, setBody] = useState(initial.body);
  const [baseHash, setBaseHash] = useState(initial.baseHash);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [tick, setTick] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  const visualBase = useRef(initial.body); // the Markdown the visual editor was loaded from
  const visualDirty = useRef(false);
  const dirty = useRef(false);
  const submitted = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<(f: File) => Promise<Upload | null>>(async () => null);

  // ------------------------------------------------------------ visual editor
  const editor = useEditor({
    extensions: editorExtensions(),
    content: fidelity.ok ? markdownToDoc(initial.body) : undefined,
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { "aria-label": "Guide text", spellcheck: "true" },
      handlePaste(_view, event) {
        const file = Array.from(event.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
        if (!file) return false;
        void insertPicture(file);
        return true;
      },
      handleDrop(_view, event) {
        const file = Array.from((event as DragEvent).dataTransfer?.files ?? []).find((f) => f.type.startsWith("image/"));
        if (!file) return false;
        void insertPicture(file);
        return true;
      },
    },
    onUpdate({ transaction }) {
      if (!transaction.docChanged) return;
      visualDirty.current = true;
      dirty.current = true;
      setTick((n) => n + 1);
    },
  });

  const getMarkdown = useCallback((): string => {
    if (view === "visual" && visualDirty.current && editor) {
      return preserveOriginal(visualBase.current, docToMarkdown(editor.state.doc));
    }
    return body;
  }, [view, body, editor]);

  async function uploadImage(file: File): Promise<Upload | null> {
    setStatus("Uploading picture…");
    const fd = new FormData();
    fd.append("image", file);
    const r = await callApi<Upload>("POST", `/api/upload/${category.slug}`, fd);
    if (!r.ok) { setStatus(r.error); return null; }
    setStatus("Picture added.");
    return r.data;
  }
  uploadRef.current = uploadImage;

  async function insertPicture(file: File) {
    const up = await uploadRef.current(file);
    if (!up) return;
    dirty.current = true;
    if (view === "visual" && editor) {
      leaveCustomBlock(editor);
      editor.chain().focus().setImage({ src: up.src, alt: up.alt }).run();
    } else {
      insertAtCursor(`\n\n${up.markdown}\n\n`);
    }
  }

  // ----------------------------------------------------------- switching views
  function switchTo(next: "visual" | "markdown") {
    if (next === view) return;
    setError("");
    if (next === "markdown") {
      if (visualDirty.current && editor) setBody(preserveOriginal(visualBase.current, docToMarkdown(editor.state.doc)));
      visualDirty.current = false;
      setView("markdown");
      return;
    }
    const check = canRoundTrip(body);
    if (!check.ok) {
      setNotice(`The visual editor can't open this text because ${check.reason}. It stays in Markdown mode so nothing is changed by accident.`);
      return;
    }
    setNotice("");
    editor?.commands.setContent(markdownToDoc(body), { emitUpdate: false });
    visualBase.current = body;
    visualDirty.current = false;
    setView("visual");
  }

  // ------------------------------------------------------------------ preview
  useEffect(() => {
    if (view === "visual" && !previewOpen) return;
    const handle = setTimeout(async () => {
      const r = await callApi<{ html: string }>("POST", "/api/preview", {
        category: category.slug, title, body: getMarkdown(),
      });
      if (r.ok) { setPreviewHtml(r.data.html); setStatus((s) => (s.startsWith("Preview") ? "" : s)); }
      else setStatus(`Preview unavailable: ${r.error}`);
    }, 600);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, previewOpen, body, tick, title, category.slug]);

  // -------------------------------------------------------------- leave guard
  useEffect(() => {
    const warn = (ev: BeforeUnloadEvent) => {
      if (dirty.current && !submitted.current) { ev.preventDefault(); ev.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  // --------------------------------------------------------------------- save
  async function save(force = false, hash = baseHash) {
    setError("");
    setBusy(true);
    const markdown = getMarkdown();
    const r = mode === "new"
      ? await callApi("POST", "/api/guides", { category: category.slug, title, description, slug, body: markdown })
      : await callApi("PUT", `/api/guides/${category.slug}/${initial.slug}`,
        { title, description, body: markdown, baseHash: hash, force });
    setBusy(false);
    if (r.ok) {
      submitted.current = true;
      router.push(`/c/${category.slug}?saved=1`);
      return;
    }
    if (r.status === 409 && r.data.conflict) {
      setConflict(String(r.data.currentHash ?? ""));
      setError(r.error);
      return;
    }
    setError(r.error);
  }
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
        ev.preventDefault();
        void saveRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // ---------------------------------------------------- markdown-mode helpers
  function setText(next: string, selStart?: number, selEnd?: number) {
    setBody(next);
    dirty.current = true;
    requestAnimationFrame(() => {
      const ta = textarea.current;
      if (!ta || selStart === undefined) return;
      ta.focus();
      ta.setSelectionRange(selStart, selEnd ?? selStart);
    });
  }
  function insertAtCursor(text: string) {
    const ta = textarea.current;
    if (!ta) { setText(body + text); return; }
    const s = ta.selectionStart, e = ta.selectionEnd;
    setText(body.slice(0, s) + text + body.slice(e), s + text.length);
  }
  function mdWrap(before: string, after: string, placeholder: string) {
    const ta = textarea.current; if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = body.slice(s, e) || placeholder;
    setText(body.slice(0, s) + before + sel + after + body.slice(e), s + before.length, s + before.length + sel.length);
  }
  function mdBlock(text: string) {
    const ta = textarea.current; if (!ta) return;
    const s = ta.selectionStart;
    const pre = s === 0 ? "" : body.slice(Math.max(0, s - 2), s) === "\n\n" ? "" : body[s - 1] === "\n" ? "\n" : "\n\n";
    const next = body.slice(0, s) + pre + text + "\n\n" + body.slice(ta.selectionEnd);
    setText(next, s + pre.length + text.length + 2);
  }
  function mdLines(prefix: (i: number) => string, placeholder: string) {
    const ta = textarea.current; if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = body.slice(s, e) || placeholder;
    const out = sel.split("\n").map((l, i) => prefix(i) + l).join("\n");
    setText(body.slice(0, s) + out + body.slice(e), s, s + out.length);
  }

  // ------------------------------------------------------------ visual toolbar
  const btn = (label: React.ReactNode, title: string, onClick: () => void, active = false, disabled = false) => (
    <button type="button" title={title} aria-pressed={active} disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{label}</button>
  );

  function openLink(ed: Editor) {
    setLinkUrl((ed.getAttributes("link").href as string) ?? "");
    setLinkOpen(true);
  }
  function applyLink(ed: Editor, url: string) {
    let href = url.trim();
    if (!href) ed.chain().focus().extendMarkRange("link").unsetLink().run();
    else {
      if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^[/#.]/.test(href) && /^[\w-]+(\.[\w-]+)+(\/|$)/.test(href)) href = `https://${href}`;
      ed.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    setLinkOpen(false);
  }

  const inCustom = editor ? insideCustom(editor) : null;
  const dis = !editor;
  const blockDis = dis || inCustom !== null; // note boxes and steps only hold plain text

  return (
    <div className="editor">
      <p className="crumb">
        <Link href="/">My guides</Link> / <Link href={`/c/${category.slug}`}>{category.name}</Link> / {mode === "new" ? "New guide" : "Edit"}
      </p>
      {error && <p className="flash err" role="alert">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      {!fidelity.ok && view === "markdown" && mode === "edit" && (
        <p className="notice">This guide opens in Markdown because {fidelity.reason}. Nothing is changed unless you edit it.</p>
      )}

      <div className="fields">
        <label>Title
          <input id="f-title" value={title} maxLength={120} required
            onChange={(e) => {
              setTitle(e.target.value); dirty.current = true;
              if (mode === "new" && !slugTouched) setSlug(slugFromTitle(e.target.value));
            }} />
        </label>
        <label>Short description <span className="muted">(shown on the guide list)</span>
          <input value={description} maxLength={300}
            onChange={(e) => { setDescription(e.target.value); dirty.current = true; }} />
        </label>
        {mode === "new" && (
          <label>Web address <span className="muted">(letters, numbers and dashes; made from the title if left empty)</span>
            <input value={slug} maxLength={60} pattern="[a-z0-9][a-z0-9\-]*"
              onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }} />
          </label>
        )}
      </div>

      <div className="tabs" role="group" aria-label="Editor mode">
        <button type="button" aria-pressed={view === "visual"} onClick={() => switchTo("visual")}>Visual</button>
        <button type="button" aria-pressed={view === "markdown"} onClick={() => switchTo("markdown")}>Markdown</button>
      </div>

      {view === "visual" ? (
        <>
          <div className="toolbar" role="toolbar" aria-label="Formatting">
            {btn("H2", "Heading", () => editor?.chain().focus().toggleHeading({ level: 2 }).run(), !!editor?.isActive("heading", { level: 2 }), blockDis)}
            {btn("H3", "Sub-heading", () => editor?.chain().focus().toggleHeading({ level: 3 }).run(), !!editor?.isActive("heading", { level: 3 }), blockDis)}
            <span className="sep" />
            {btn(<b>B</b>, "Bold", () => editor?.chain().focus().toggleBold().run(), !!editor?.isActive("bold"), blockDis)}
            {btn(<i>I</i>, "Italic", () => editor?.chain().focus().toggleItalic().run(), !!editor?.isActive("italic"), blockDis)}
            {btn("</>", "Code (chip)", () => editor?.chain().focus().toggleCode().run(), !!editor?.isActive("code"), dis)}
            {btn("Link", "Link", () => editor && openLink(editor), !!editor?.isActive("link"), blockDis)}
            <span className="sep" />
            {btn("• List", "Bullet list", () => editor?.chain().focus().toggleBulletList().run(), !!editor?.isActive("bulletList"), blockDis)}
            {btn("1. List", "Numbered list", () => editor?.chain().focus().toggleOrderedList().run(), !!editor?.isActive("orderedList"), blockDis)}
            {btn("Quote", "Quote", () => editor?.chain().focus().toggleBlockquote().run(), !!editor?.isActive("blockquote"), blockDis)}
            {btn("Code block", "Code block", () => editor?.chain().focus().toggleCodeBlock().run(), !!editor?.isActive("codeBlock"), blockDis)}
            {btn("―", "Divider line", () => editor?.chain().focus().setHorizontalRule().run(), false, blockDis)}
            <span className="sep" />
            {btn("Note box", "Highlighted note", () => editor && insertCallout(editor), false, blockDis)}
            {btn("Steps", "Numbered steps", () => editor && insertSteps(editor), false, blockDis)}
            {btn("Picture", "Upload a picture", () => fileInput.current?.click(), false, dis)}
            {inCustom === "steps" && (
              <>
                <span className="sep" />
                {btn("+ Step", "Add a step after this one", () => editor && addStep(editor))}
                {btn("− Step", "Remove this step", () => editor && removeStep(editor))}
              </>
            )}
            {inCustom && (
              <button type="button" className="warn" onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor && removeEnclosing(editor, inCustom)}>
                Remove {inCustom === "callout" ? "note box" : "steps"}
              </button>
            )}
            <span className="status" aria-live="polite">{status}</span>
          </div>
          {linkOpen && editor && (
            <div className="linkbar">
              <input autoFocus value={linkUrl} placeholder="https://… (empty removes the link)"
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyLink(editor, linkUrl); } if (e.key === "Escape") setLinkOpen(false); }} />
              <button type="button" className="btn small" onClick={() => applyLink(editor, linkUrl)}>Apply</button>
              <button type="button" className="btn small ghost" onClick={() => setLinkOpen(false)}>Cancel</button>
            </div>
          )}
          <div className={`panes${previewOpen ? "" : " single"}`}>
            <div className="visual" onClick={() => editor?.commands.focus()}>
              <EditorContent editor={editor} />
            </div>
            {previewOpen && <iframe className="preview-frame" sandbox="" title="Preview as published" srcDoc={previewHtml} />}
          </div>
          <p>
            <button type="button" className="btn small ghost" onClick={() => setPreviewOpen((v) => !v)}>
              {previewOpen ? "Hide preview" : "Show preview as published"}
            </button>
          </p>
        </>
      ) : (
        <>
          <div className="toolbar" role="toolbar" aria-label="Markdown snippets">
            {btn("H2", "Heading", () => mdLines(() => "## ", "Heading"))}
            {btn(<b>B</b>, "Bold", () => mdWrap("**", "**", "bold text"))}
            {btn(<i>I</i>, "Italic", () => mdWrap("*", "*", "italic text"))}
            {btn("</>", "Code", () => mdWrap("`", "`", "code"))}
            {btn("Link", "Link", () => mdWrap("[", "](https://)", "link text"))}
            {btn("• List", "Bullet list", () => mdLines(() => "- ", "Item"))}
            {btn("1. List", "Numbered list", () => mdLines((i) => `${i + 1}. `, "Item"))}
            {btn("Code block", "Code block", () => mdBlock("```\ncommand here\n```"))}
            {btn("Note box", "Highlighted note", () => mdBlock("::: callout Note\nWrite the tip or warning here.\n:::"))}
            {btn("Steps", "Numbered steps", () => mdBlock("::: steps\n1. **First step**\n   What to do.\n\n2. **Second step**\n   What to do.\n:::"))}
            {btn("Picture", "Upload a picture", () => fileInput.current?.click())}
            <span className="status" aria-live="polite">{status}</span>
          </div>
          <div className="panes">
            <textarea ref={textarea} value={body} spellCheck aria-label="Guide text (Markdown)"
              onChange={(e) => { setBody(e.target.value); dirty.current = true; }}
              onPaste={(e) => {
                const f = Array.from(e.clipboardData.files).find((x) => x.type.startsWith("image/"));
                if (f) { e.preventDefault(); void insertPicture(f); }
              }} />
            <iframe className="preview-frame" sandbox="" title="Preview as published" srcDoc={previewHtml} />
          </div>
        </>
      )}

      <input ref={fileInput} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void insertPicture(f); e.target.value = ""; }} />

      <div className="row sticky-actions">
        {conflict !== null && (
          <button className="btn danger" type="button" disabled={busy}
            onClick={() => { setBaseHash(conflict); setConflict(null); void save(true, conflict); }}>
            Save anyway (replace their changes)
          </button>
        )}
        <button className="btn" type="button" disabled={busy} onClick={() => void save()}>
          {busy ? "Publishing…" : "Save and publish"}
        </button>
        <Link className="btn ghost" href={`/c/${category.slug}`}>Cancel</Link>
        <span className="muted">Ctrl+S saves. Changes go live on the guides site within about a minute.</span>
      </div>
    </div>
  );
}
