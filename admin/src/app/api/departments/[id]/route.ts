import { api, readJson } from "@/lib/api";
import { departmentOr404 } from "@/lib/departments";
import { ValidationError } from "@/lib/errors";
import * as guides from "@/lib/guides";
import { publishAs } from "@/lib/publish";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";
type P = { id: string };

export const PATCH = api<P>(async ({ req, svc, user, params }) => {
  requireAdmin(user);
  const dept = departmentOr404(svc.db, Number(params.id));
  const data = await readJson(req);
  const name = guides.checkDisplayName(data.name as string);
  const color = guides.checkColor(data.color as string);
  const clash = svc.db.get("SELECT id FROM departments WHERE lower(name) = ? AND id != ?",
    name.toLowerCase(), dept.id);
  if (clash) throw new ValidationError("Another department already has that name.");
  const inYaml = await svc.repo.read((root) => guides.loadCategories(root).some((c) => c.slug === dept.slug));
  if (inYaml) {
    await publishAs(svc, user, `Rename category ${dept.slug} to ${name}`, (root) =>
      guides.updateCategory(root, dept.slug, name, color));
  }
  svc.db.tx(() => {
    svc.db.run("UPDATE departments SET name = ? WHERE id = ?", name, dept.id);
    svc.db.log(user.username, "department.update", `${dept.name} -> ${name}`);
  });
  return { ok: true };
});

export const DELETE = api<P>(async ({ svc, user, params }) => {
  requireAdmin(user);
  const dept = departmentOr404(svc.db, Number(params.id));
  svc.db.tx(() => {
    svc.db.run("DELETE FROM departments WHERE id = ?", dept.id);
    svc.db.log(user.username, "department.delete", `${dept.name} (${dept.slug})`);
  });
  return { ok: true };
});
