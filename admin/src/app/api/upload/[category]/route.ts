import { api } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import * as guides from "@/lib/guides";
import { publishAs } from "@/lib/publish";
import { getCategory } from "@/lib/session";

export const dynamic = "force-dynamic";

export const POST = api<{ category: string }>(async ({ req, svc, user, params }) => {
  const { category } = params;
  await svc.repo.read((root) => getCategory(svc, user, root, category));
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > svc.cfg.maxImageBytes + 200_000) throw new ValidationError("That picture is too large.");
  let file: FormDataEntryValue | null = null;
  try {
    file = (await req.formData()).get("image");
  } catch {
    throw new ValidationError("Choose a picture to upload.");
  }
  if (!file || typeof file === "string") throw new ValidationError("Choose a picture to upload.");
  const data = Buffer.from(await file.arrayBuffer());
  const rel = await publishAs(svc, user, `Add picture to ${category}`, (root) =>
    guides.saveImage(root, category, file.name || "image", data, svc.cfg.maxImageBytes));
  svc.db.log(user.username, "image.upload", rel);
  const alt = guides.slugify((file.name || "image").replace(/\.[^.]+$/, ""), 40).replace(/-/g, " ");
  return { path: rel, src: `../images/${rel}`, alt, markdown: `![${alt}](../images/${rel})` };
});
