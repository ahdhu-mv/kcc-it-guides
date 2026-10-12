import { api } from "@/lib/api";
import { departmentOr404 } from "@/lib/departments";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export const DELETE = api<{ id: string; username: string }>(async ({ svc, user, params }) => {
  requireAdmin(user);
  const dept = departmentOr404(svc.db, Number(params.id));
  svc.db.tx(() => {
    svc.db.run("DELETE FROM members WHERE department_id = ? AND username = ?", dept.id, params.username.toLowerCase());
    svc.db.log(user.username, "member.remove", `${params.username} from ${dept.name}`);
  });
  return { ok: true };
});
