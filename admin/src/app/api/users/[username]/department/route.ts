import { api, readJson } from "@/lib/api";
import { Db } from "@/lib/db";
import { departmentOr404, parseUsernames } from "@/lib/departments";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export const POST = api<{ username: string }>(async ({ req, svc, user, params }) => {
  requireAdmin(user);
  const [name] = parseUsernames(params.username);
  const dept = departmentOr404(svc.db, Number((await readJson(req)).departmentId));
  svc.db.tx(() => {
    svc.db.run("INSERT OR IGNORE INTO members (department_id, username, added_at, added_by) VALUES (?, ?, ?, ?)",
      dept.id, name, Db.now(), user.username);
    svc.db.log(user.username, "member.add", `${name} -> ${dept.name}`);
  });
  return { ok: true };
});
