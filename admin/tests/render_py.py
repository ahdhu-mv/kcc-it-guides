"""Test helper: render a JSON list of Markdown bodies with the site's real builder."""
import json
import sys
from pathlib import Path

repo_root = Path(sys.argv[1])
sys.path.insert(0, str(repo_root))
import build  # noqa: E402

bodies = json.load(sys.stdin)
print(json.dumps([build.render_markdown_body(b)[0] for b in bodies]))
