import fs from "node:fs";
import path from "node:path";
import { api } from "@/lib/api";
import { attachmentPath, FILE_KINDS } from "@/lib/attachments";
import { HttpError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** Download an attachment from inside the admin (used by the clean-up page). */
export const GET = api<{ path: string[] }>(async ({ svc, params }) => {
  const rel = params.path.join("/");
  const data = await svc.repo.read((root) => {
    const f = attachmentPath(root, rel);
    return f ? { bytes: fs.readFileSync(f), name: path.basename(f) } : null;
  });
  const kind = data && FILE_KINDS[path.extname(data.name).slice(1).toLowerCase()];
  if (!data || !kind) throw new HttpError(404, "Not found", "That file doesn't exist.");
  return new Response(new Uint8Array(data.bytes), {
    headers: {
      "Content-Type": kind.mime,
      "Content-Disposition": `attachment; filename="${data.name}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cache-Control": "private, no-store",
    },
  });
});
