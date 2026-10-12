import { api, readJson, str } from "@/lib/api";
import * as guides from "@/lib/guides";
import { publishAs } from "@/lib/publish";
import { getCategory } from "@/lib/session";

export const dynamic = "force-dynamic";

export const POST = api(async ({ req, svc, user }) => {
  const data = await readJson(req);
  const category = str(data.category);
  await svc.repo.read((root) => getCategory(svc, user, root, category));
  const title = guides.checkTitle(str(data.title));
  const slug = (str(data.slug).trim() || guides.slugify(title)).toLowerCase();
  guides.checkSlug(slug, "guide address");
  await publishAs(svc, user, `Add guide ${category}/${slug}`, (root) =>
    guides.writeGuide(root, category, slug, {
      title, description: str(data.description), body: str(data.body),
      today: guides.todayIn(svc.cfg.timezone), maxBytes: svc.cfg.maxBodyBytes,
    }, { create: true }));
  svc.db.log(user.username, "guide.create", `${category}/${slug}`);
  return { ok: true, title, slug };
});
