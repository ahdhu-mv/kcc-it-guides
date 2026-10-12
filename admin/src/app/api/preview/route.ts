import { api, readJson, str } from "@/lib/api";
import * as guides from "@/lib/guides";
import { renderPreview } from "@/lib/preview";
import { getCategory } from "@/lib/session";

export const dynamic = "force-dynamic";

export const POST = api(async ({ req, svc, user }) => {
  const data = await readJson(req);
  const body = guides.checkBody(str(data.body), svc.cfg.maxBodyBytes);
  const { name, root } = await svc.repo.read((r) => ({ name: getCategory(svc, user, r, str(data.category)).name, root: r }));
  const html = await renderPreview(svc.cfg, root, name, str(data.title).slice(0, 200), body);
  return { html };
});
