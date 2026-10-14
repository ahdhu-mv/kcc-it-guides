import { api } from "@/lib/api";
import { deleteUnused } from "@/lib/attachments";
import { ValidationError } from "@/lib/errors";
import { publishAs } from "@/lib/publish";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Delete a picture or attachment that no guide uses (IT admins only). */
export const DELETE = api<{ kind: string; category: string; name: string }>(async ({ svc, user, params }) => {
  requireAdmin(user);
  const kind = params.kind === "files" ? "file" : params.kind === "images" ? "image" : null;
  if (!kind) throw new ValidationError("Unknown kind of file.");
  const rel = `${params.category}/${params.name}`;
  await publishAs(svc, user, `Delete unused ${kind} ${rel}`, (root) => deleteUnused(root, kind, rel));
  svc.db.log(user.username, `${kind}.delete`, rel);
  return { ok: true };
});
