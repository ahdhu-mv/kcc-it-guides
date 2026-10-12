import { api, readJson, str } from "@/lib/api";
import { planDepartment } from "@/lib/departments";
import * as guides from "@/lib/guides";
import { publishAs } from "@/lib/publish";
import { requireAdmin } from "@/lib/session";
import { Db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const POST = api(async ({ req, svc, user }) => {
  requireAdmin(user);
  const data = await readJson(req);
  const plan = await svc.repo.read((root) => planDepartment(svc.db, root, {
    name: data.name, mode: data.mode, slug: data.slug, existingSlug: data.existingSlug, color: data.color,
  }));
  if (plan.mode === "new") {
    await publishAs(svc, user, `Add category ${plan.slug} for department ${plan.name}`, (root) =>
      guides.addCategory(root, plan.slug, plan.name, plan.color));
  }
  const id = svc.db.tx(() => {
    const r = svc.db.run(
      "INSERT INTO departments (name, slug, created_at, created_by) VALUES (?, ?, ?, ?)",
      plan.name, plan.slug, Db.now(), user.username);
    svc.db.log(user.username, "department.create", `${plan.name} (${plan.slug})`);
    return r.lastId;
  });
  return { ok: true, id, name: str(plan.name) };
});
