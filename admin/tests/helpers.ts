import { spawnSync } from "node:child_process";
import path from "node:path";

export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const PYTHON = process.env.PYTHON_BIN || "python3";

export function pythonHasBuilder(): boolean {
  const r = spawnSync(PYTHON, ["-c", "import markdown, nh3, yaml, jinja2, pygments"], { encoding: "utf8" });
  return r.status === 0;
}

/** Render Markdown bodies with the real site builder (build.py). */
export function renderWithSite(bodies: string[]): string[] {
  const r = spawnSync(PYTHON, [path.join(__dirname, "render_py.py"), REPO_ROOT], {
    input: JSON.stringify(bodies), encoding: "utf8", maxBuffer: 50_000_000,
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}

export const normHtml = (h: string) => h.replace(/\s+/g, " ").replace(/> </g, "><").trim();

export function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}
