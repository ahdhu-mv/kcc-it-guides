import fs from "node:fs";
import path from "node:path";
import { api } from "@/lib/api";
import { HttpError } from "@/lib/errors";
import { imagePath, MIME_BY_EXT } from "@/lib/guides";

export const dynamic = "force-dynamic";

/** Pictures stored in the repo, shown inside the editor (any signed-in person; they are public on the site anyway). */
export const GET = api<{ path: string[] }>(async ({ svc, params }) => {
  const rel = params.path.join("/");
  const data = await svc.repo.read((root) => {
    const file = imagePath(root, rel);
    return file ? { bytes: fs.readFileSync(file), ext: path.extname(file).slice(1).toLowerCase() } : null;
  });
  const mime = data && MIME_BY_EXT[data.ext];
  if (!data || !mime) throw new HttpError(404, "Not found", "That picture doesn't exist.");
  return new Response(new Uint8Array(data.bytes), {
    headers: {
      "Content-Type": mime,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cache-Control": "private, max-age=60",
    },
  });
});
