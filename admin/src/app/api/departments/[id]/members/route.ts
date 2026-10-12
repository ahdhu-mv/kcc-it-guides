import { api, readJson, str } from "@/lib/api";
import { Db } from "@/lib/db";
import { departmentOr404, parseUsernames } from "@/lib/departments";
import { ValidationError } from "@/lib/errors";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export const POST = api<{ id: string }>(async ({ req, svc, user, params }) => {
  requireAdmin(user);
  const dept = departmentOr404(svc.db, Number(params.id));
  const names = parseUsernames(str((await readJson(req)).usernames));
  if (!names.length) throw new ValidationError("Enter at least one username.");
  svc.db.tx(() => {
    for (const n of names) {
      svc.db.run("INSERT OR IGNORE INTO members (department_id, username, added_at, added_by) VALUES (?, ?, ?, ?)",
        dept.id, n, Db.now(), user.username);
    }
    svc.db.log(user.username, "member.add", `${names.join(", ")} -> ${dept.name}`);
  });
  return { ok: true, added: names };
});
