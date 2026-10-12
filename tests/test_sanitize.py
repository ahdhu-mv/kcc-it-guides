import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build


def test_dangerous_html_stripped():
    out = build.render_markdown_body(
        '<script>alert(1)</script><img src=x onerror=alert(2)><iframe src="//e"></iframe>'
        '<a href="javascript:alert(3)">x</a><p style="color:red">ok</p>\n\n**bold**')
    html = out[0] if isinstance(out, tuple) else out
    for bad in ("<script", "onerror", "<iframe", "javascript:", "style="):
        assert bad not in html
    assert "<strong>bold</strong>" in html
