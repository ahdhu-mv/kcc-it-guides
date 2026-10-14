import { api } from "@/lib/api";
import { humanSize, saveAttachment } from "@/lib/attachments";
import { ValidationError } from "@/lib/errors";
import { publishAs } from "@/lib/publish";
import { getCategory } from "@/lib/session";

export const dynamic = "force-dynamic";

export const POST = api<{ category: string }>(async ({ req, svc, user, params }) => {
  const { category } = params;
  await svc.repo.read((root) => getCategory(svc, user, root, category));
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > svc.cfg.maxFileBytes + 200_000) {
    throw new ValidationError(`That file is too large (maximum ${Math.floor(svc.cfg.maxFileBytes / 1_000_000)} MB).`);
  }
  let file: FormDataEntryValue | null = null;
  try {
    file = (await req.formData()).get("file");
  } catch {
    throw new ValidationError("Choose a file to attach.");
  }
  if (!file || typeof file === "string") throw new ValidationError("Choose a file to attach.");
  const data = Buffer.from(await file.arrayBuffer());
  const saved = await publishAs(svc, user, `Attach file to ${category}`, (root) =>
    saveAttachment(root, category, file.name || "file", data, svc.cfg.maxFileBytes));
  svc.db.log(user.username, "file.upload", saved.rel);
  const base = (file.name || "file").replace(/\.[^.]+$/, "").replace(/[\[\]\r\n]+/g, " ").trim() || "File";
  const text = `${base} (${saved.label}, ${humanSize(saved.size)})`;
  const href = `../files/${saved.rel}`;
  return { path: saved.rel, href, text, markdown: `[${text}](${href})` };
});
