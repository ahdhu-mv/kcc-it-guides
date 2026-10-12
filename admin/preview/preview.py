"""
Renders a guide preview with the site's own build.py (found in the repo clone).
stdin : {"category_name": str, "title": str, "body": str}
argv[1]: path of the repo clone
stdout: {"html": "<full page>"}  or  {"error": "..."}
"""
import base64
import html as html_lib
import importlib.util
import json
import re
import sys
from pathlib import Path

MIME_BY_EXT = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif",
               "webp": "image/webp", "svg": "image/svg+xml"}
IMG_SRC = re.compile(r'src="\.\./images/([A-Za-z0-9_./-]+)"')


def load_builder(root: Path):
    path = root / "build.py"
    if not path.is_file():
        raise RuntimeError("build.py not found in the repository.")
    spec = importlib.util.spec_from_file_location("kcc_site_build", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not hasattr(module, "sanitize_html"):
        raise RuntimeError("The repository's build.py is too old (no HTML sanitizing). Update build.py first.")
    return module


def inline_images(root: Path, page: str) -> str:
    images = (root / "content" / "images").resolve()

    def repl(match):
        target = (images / match.group(1)).resolve()
        if images not in target.parents or not target.is_file() or target.stat().st_size > 6_000_000:
            return match.group(0)
        mime = MIME_BY_EXT.get(target.suffix.lstrip(".").lower())
        if not mime:
            return match.group(0)
        return f'src="data:{mime};base64,{base64.b64encode(target.read_bytes()).decode()}"'

    return IMG_SRC.sub(repl, page)


def main():
    root = Path(sys.argv[1])
    req = json.load(sys.stdin)
    try:
        builder = load_builder(root)
        body_html, _toc = builder.render_markdown_body(req.get("body", ""))
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)[:300]}))
        return
    body_html = inline_images(root, body_html)
    css_path = root / "assets" / "css" / "style.css"
    css = css_path.read_text(encoding="utf-8") if css_path.is_file() else ""
    css = css.replace("</", "<\\/")
    title = html_lib.escape(req.get("title") or "Untitled guide")
    cat = html_lib.escape(req.get("category_name", ""))
    page = (
        '<!DOCTYPE html><html><head><meta charset="utf-8">'
        f"<style>{css}\nbody{{background:#fff}}.guide-layout{{display:block}}</style></head><body>"
        '<div style="padding:24px 28px"><div class="guide-main">'
        f'<div class="guide-tags"><span class="tag">{cat}</span></div>'
        f"<h1>{title}</h1>"
        f'<div class="guide-body">{body_html}</div></div></div></body></html>'
    )
    print(json.dumps({"html": page}))


if __name__ == "__main__":
    main()
