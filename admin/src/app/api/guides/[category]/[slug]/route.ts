import { NextResponse } from "next/server";
import { api, readJson, str } from "@/lib/api";
import { Conflict } from "@/lib/errors";
import * as guides from "@/lib/guides";
import { publishAs } from "@/lib/publish";
import { getCategory } from "@/lib/session";

export const dynamic = "force-dynamic";
type P = { category: string; slug: string };

export const PUT = api<P>(async ({ req, svc, user, params }) => {
  const { category, slug } = params;
  const data = await readJson(req);
  await svc.repo.read((root) => getCategory(svc, user, root, category));
  guides.checkSlug(slug, "guide address");
  try {
    const title = await publishAs(svc, user, `Update guide ${category}/${slug}`, (root) =>
      guides.writeGuide(root, category, slug, {
        title: str(data.title), description: str(data.description), body: str(data.body),
        today: guides.todayIn(svc.cfg.timezone), maxBytes: svc.cfg.maxBodyBytes,
      }, { create: false, baseHash: str(data.baseHash), force: data.force === true }));
    svc.db.log(user.username, "guide.update", `${category}/${slug}`);
    return { ok: true, title };
  } catch (err) {
    if (err instanceof Conflict) {
      const current = await svc.repo.read((root) => guides.readGuide(root, category, slug));
      return NextResponse.json(
        { error: err.message, conflict: true, currentHash: current?.hash ?? "" }, { status: 409 });
    }
    throw err;
  }
});

export const DELETE = api<P>(async ({ svc, user, params }) => {
  const { category, slug } = params;
  await svc.repo.read((root) => getCategory(svc, user, root, category));
  guides.checkSlug(slug, "guide address");
  const title = await publishAs(svc, user, `Delete guide ${category}/${slug}`, (root) =>
    guides.deleteGuide(root, category, slug));
  svc.db.log(user.username, "guide.delete", `${category}/${slug}`);
  return { ok: true, title };
});
