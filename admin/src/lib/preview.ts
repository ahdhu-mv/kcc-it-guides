/**
 * Preview rendering. This asks the site's own builder (build.py in the clone)
 * to render the page, so what an editor sees is what readers will get —
 * callouts, steps, syntax colouring and the HTML allow-list included.
 */
import { spawn } from "node:child_process";
import type { Config } from "./config";
import { HttpError } from "./errors";

export function renderPreview(
  cfg: Config, root: string, categoryName: string, title: string, body: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cfg.pythonBin, [cfg.previewScript, root], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) =>
      reject(new HttpError(503, "Preview unavailable", `The preview could not start (${e.message}).`)));
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(out);
        if (parsed.html) resolve(parsed.html as string);
        else reject(new HttpError(503, "Preview unavailable", parsed.error || "The preview failed."));
      } catch {
        reject(new HttpError(503, "Preview unavailable", (err.trim().split("\n").pop() || "The preview failed.").slice(0, 300)));
      }
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify({ category_name: categoryName, title, body }));
  });
}
