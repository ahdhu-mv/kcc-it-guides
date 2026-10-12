import Link from "next/link";
import { AddUserToDepartment } from "@/components/DepartmentForms";
import { ErrorView } from "@/components/ErrorView";
import { guard } from "@/lib/page";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export default function People() {
  return guard("/admin/users", async ({ svc, session }) => {
    requireAdmin(session.user);
    const departments = svc.db.departments();
    const rows = svc.db.knownUsers().map((u) => ({
      u, depts: svc.db.departmentsForUser(u.username), isAdmin: svc.cfg.adminUsers.has(u.username),
    }));
    return (
      <>
        <h1>People</h1>
        <p className="muted">Everyone who has opened this site appears here. To add someone who hasn&apos;t, add their username from the department page.</p>
        <table className="list">
          <thead><tr><th>Person</th><th>Departments</th><th>Last seen (UTC)</th><th>Add to department</th></tr></thead>
          <tbody>
            {rows.map(({ u, depts, isAdmin }) => (
              <tr key={u.username}>
                <td><b>{u.display_name || u.username}</b>{isAdmin && <> <span className="tag">admin</span></>}<br />
                  <span className="muted">{u.username} {u.email}</span></td>
                <td>{depts.length ? depts.map((d) => <Link key={d.id} className="tag" href={`/admin/departments/${d.id}`}>{d.name}</Link>) : <span className="muted">—</span>}</td>
                <td className="nowrap">{u.last_seen}</td>
                <td>{departments.length > 0 && <AddUserToDepartment username={u.username} departments={departments.map((d) => ({ id: d.id, name: d.name }))} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  }, (e) => <ErrorView error={e} />);
}
