#!/usr/bin/env python3
"""
Builds the KCC IT Guides static site.

Reads:
  categories.yaml         -- category slugs, display names, colors
  content/<slug>/*.md      -- one guide per file, YAML frontmatter + body
  templates/*.j2           -- page templates

Writes:
  dist/index.html
  dist/<category-slug>/<guide-slug>.html
  dist/assets/...

Run:  python3 build.py
Re-run any time a .md file is added, removed or edited — the whole
site regenerates from scratch, so dist/ never goes stale or drifts.
"""

import os
import re
import shutil
from datetime import date, datetime
from pathlib import Path

import markdown
import yaml
from jinja2 import Environment, FileSystemLoader

ROOT = Path(__file__).parent
CONTENT_DIR = ROOT / "content"
TEMPLATES_DIR = ROOT / "templates"
ASSETS_DIR = ROOT / "assets"
DIST_DIR = ROOT / "dist"
CATEGORIES_FILE = ROOT / "config" / "categories.yaml"

env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)))


# ---------------------------------------------------------------- helpers

def slugify(path: Path) -> str:
    return path.stem


def format_date(d) -> str:
    if isinstance(d, (date, datetime)):
        return d.strftime("%-d %b %Y")
    return str(d)


def parse_frontmatter(text: str):
    """Split a `---\\nkey: value\\n---\\nbody` file into (dict, body)."""
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", text, re.DOTALL)
    if not match:
        raise ValueError("Missing YAML frontmatter (expected --- ... --- at top of file)")
    meta = yaml.safe_load(match.group(1)) or {}
    body = match.group(2)
    return meta, body


CODE_RE = re.compile(r"`([^`]+)`")


def inline_code(text: str) -> str:
    return CODE_RE.sub(r"<code>\1</code>", text)


def render_callout(title: str, body: str) -> str:
    body = inline_code(body.strip())
    return f'<div class="callout"><b>{title}</b>{body}</div>'


STEP_ITEM_RE = re.compile(
    r"^\d+\.\s+\*\*(.+?)\*\*\s*\n((?:(?!^\d+\.\s+\*\*).+\n?)*)",
    re.MULTILINE,
)


def render_steps(block: str) -> str:
    items = []
    for m in STEP_ITEM_RE.finditer(block.strip() + "\n"):
        title = m.group(1).strip()
        body_lines = [ln.strip() for ln in m.group(2).strip().splitlines() if ln.strip()]
        body = inline_code(" ".join(body_lines))
        items.append(
            f'<li><div class="step-title">{title}</div>'
            f'<div class="step-body">{body}</div></li>'
        )
    return '<ol class="steps">' + "".join(items) + "</ol>"


CALLOUT_BLOCK_RE = re.compile(
    r"^::: *callout +(.+?)\s*\n(.*?)\n::: *$", re.DOTALL | re.MULTILINE
)
STEPS_BLOCK_RE = re.compile(r"^::: *steps *\n(.*?)\n::: *$", re.DOTALL | re.MULTILINE)

# Matches a fenced code block of 3+ backticks, requiring the closing fence
# to use the same (or a longer) run of backticks as the opening one — the
# same rule Markdown itself uses, and what lets a 4-backtick fence safely
# show a 3-backtick fence as literal example text.
FENCE_SPAN_RE = re.compile(r"(?:^|\n)(`{3,})[^\n]*\n.*?\n\1(?=\n|$)", re.DOTALL)


def protected_sub(pattern, repl_func, text):
    """
    Like pattern.sub(repl_func, text), but never touches a match that
    falls inside a fenced code block — e.g. a guide showing the literal
    `::: callout ... :::` syntax as a documented example shouldn't have
    that example itself rendered as a real callout.
    """
    spans = [m.span() for m in FENCE_SPAN_RE.finditer(text)]

    def wrapper(m):
        if any(start <= m.start() < end for start, end in spans):
            return m.group(0)
        return repl_func(m)

    return pattern.sub(wrapper, text)


def render_markdown_body(md_text: str):
    """
    Converts guide body markdown to HTML.
    Custom ::: callout / ::: steps blocks are pulled out first (as they
    aren't standard markdown), rendered by hand, then spliced back in
    after the rest of the text goes through the markdown library —
    this also gives us auto-generated heading ids for the TOC.
    """
    blocks = {}

    def stash_callout(m):
        key = f"@@BLOCK{len(blocks)}@@"
        blocks[key] = render_callout(m.group(1), m.group(2))
        return f"\n<div>{key}</div>\n"

    def stash_steps(m):
        key = f"@@BLOCK{len(blocks)}@@"
        blocks[key] = render_steps(m.group(1))
        return f"\n<div>{key}</div>\n"

    # Fenced spans are recomputed before each pass, since the previous
    # substitution can shift text positions.
    md_text = protected_sub(CALLOUT_BLOCK_RE, stash_callout, md_text)
    md_text = protected_sub(STEPS_BLOCK_RE, stash_steps, md_text)

    md = markdown.Markdown(extensions=["toc", "fenced_code", "codehilite"], extension_configs={
        "toc": {"permalink": False},
        "codehilite": {"guess_lang": False},
    })
    html = md.convert(md_text)

    for key, rendered in blocks.items():
        html = html.replace(f"<div>{key}</div>", rendered)

    # md.toc_tokens is a flat list of {level, id, name} for every heading
    toc = [
        {"id": tok["id"], "text": tok["name"]}
        for tok in getattr(md, "toc_tokens", [])
        if tok["level"] == 2
    ]
    return html, toc


# ---------------------------------------------------------------- build

def fix_permissions(path: Path):
    """
    Force standard, web-servable permissions (755 for directories, 644
    for files) on everything under path, regardless of what permissions
    the source had.

    This matters because assets/ is copied from a bind-mounted host
    folder (shutil.copytree preserves the source's original permission
    bits by default) — and depending on how that folder was created on
    the host (a restrictive umask during a git checkout, for instance),
    it can end up unreadable by nginx's worker process, which runs as
    an unprivileged user, not root. That produces a 403 on every static
    asset while the HTML pages (written fresh by this script, inside
    the container) work fine — a confusing split that looks like a
    proxy or server misconfiguration but is really just inherited
    permissions from whatever host this happens to be built on.
    """
    for root, dirs, files in os.walk(path):
        os.chmod(root, 0o755)
        for f in files:
            os.chmod(os.path.join(root, f), 0o644)


def load_categories():
    return yaml.safe_load(CATEGORIES_FILE.read_text())


def load_guides_for_category(cat_slug: str):
    guides = []
    cat_dir = CONTENT_DIR / cat_slug
    if not cat_dir.exists():
        return guides
    for md_path in sorted(cat_dir.glob("*.md")):
        text = md_path.read_text()
        try:
            meta, body = parse_frontmatter(text)
        except ValueError as e:
            print(f"  ! skipping {md_path}: {e}")
            continue
        slug = slugify(md_path)
        guides.append({
            "slug": slug,
            "title": meta.get("title", slug),
            "description": meta.get("description", ""),
            "updated": format_date(meta.get("updated", "")),
            "updated_raw": meta.get("updated", date.min),
            "body_md": body,
            "url": f"{cat_slug}/{slug}.html",
        })
    # newest-updated first
    guides.sort(key=lambda g: g["updated_raw"], reverse=True)
    return guides


UNCATEGORIZED_SLUG = "general"


def load_uncategorized_guides():
    """
    Guides placed directly in content/ (not in any category subfolder) —
    for a one-off guide that doesn't belong anywhere specific yet. They're
    grouped into a "General" section on the homepage automatically.
    """
    guides = []
    for md_path in sorted(CONTENT_DIR.glob("*.md")):
        text = md_path.read_text()
        try:
            meta, body = parse_frontmatter(text)
        except ValueError as e:
            print(f"  ! skipping {md_path}: {e}")
            continue
        slug = slugify(md_path)
        guides.append({
            "slug": slug,
            "title": meta.get("title", slug),
            "description": meta.get("description", ""),
            "updated": format_date(meta.get("updated", "")),
            "updated_raw": meta.get("updated", date.min),
            "body_md": body,
            "url": f"{UNCATEGORIZED_SLUG}/{slug}.html",
        })
    guides.sort(key=lambda g: g["updated_raw"], reverse=True)
    return guides


def build():
    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)
    DIST_DIR.mkdir(parents=True)
    shutil.copytree(ASSETS_DIR, DIST_DIR / "assets")

    base_tpl = env.get_template("base.html.j2")
    index_tpl = env.get_template("index_content.html.j2")
    guide_tpl = env.get_template("guide_content.html.j2")

    categories = load_categories()
    total_guides = 0

    for cat in categories:
        cat["guides"] = load_guides_for_category(cat["slug"])
        total_guides += len(cat["guides"])

    # Guides dropped straight into content/ with no category folder —
    # grouped into a "General" section, only shown if any exist.
    uncategorized = load_uncategorized_guides()
    if uncategorized:
        categories.append({
            "slug": UNCATEGORIZED_SLUG,
            "name": "General",
            "color": "#7c8a94",
            "guides": uncategorized,
        })
        total_guides += len(uncategorized)

    # --- homepage ---
    index_content = index_tpl.render(
        categories=categories,
        guide_count=total_guides,
        category_count=len(categories),
        build_date=date.today().strftime("%-d %B %Y"),
        root="",
    )
    (DIST_DIR / "index.html").write_text(
        base_tpl.render(title="All guides", content=index_content, root="")
    )
    print(f"wrote index.html  ({total_guides} guides across {len(categories)} categories)")

    # --- one page per guide ---
    for cat in categories:
        out_dir = DIST_DIR / cat["slug"]
        out_dir.mkdir(exist_ok=True)
        for guide in cat["guides"]:
            body_html, toc = render_markdown_body(guide["body_md"])
            guide_content = guide_tpl.render(
                category=cat, guide=guide, body_html=body_html, toc=toc, root="../"
            )
            page_html = base_tpl.render(title=guide["title"], content=guide_content, root="../")
            (out_dir / f"{guide['slug']}.html").write_text(page_html)
            print(f"wrote {cat['slug']}/{guide['slug']}.html")

    fix_permissions(DIST_DIR)
    print(f"\nDone. Open dist/index.html or serve dist/ with any static file server.")


if __name__ == "__main__":
    build()
