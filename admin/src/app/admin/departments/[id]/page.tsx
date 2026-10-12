import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmButton } from "@/components/ConfirmButton";
import { AddMembersForm, EditDepartmentForm } from "@/components/DepartmentForms";
import { ErrorView } from "@/components/ErrorView";
import * as guides from "@/lib/guides";
import { guard } from "@/lib/page";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DepartmentPage(
  { params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> },
) {
  const { id } = await params;
  const q = await searchParams;
  return guard(`/admin/departments/${id}`, async ({ svc, session }) => {
    requireAdmin(session.user);
    const dept = svc.db.department(Number(id));
    if (!dept) notFound();
    const { cat, count } = await svc.repo.read((root) => ({
      cat: guides.categoryMap(root)[dept.slug], count: guides.listGuides(root, dept.slug).length,
    }));
    const people = svc.db.members(dept.id);
    const have = new Set(people.map((p) => p.username));
    const suggestions = svc.db.knownUsers().filter((u) => !have.has(u.username));
    return (
      <>
        <p className="crumb"><Link href="/admin/departments">Departments</Link> / {dept.name}</p>
        {q.created && <p className="flash">Department created. Now add the people who may edit its guides.</p>}
        <div className="head">
          <h1>{dept.name}</h1>
          <Link className="btn" href={`/c/${dept.slug}`}>Open guides ({count})</Link>
        </div>
        <div className="two">
          <section className="card">
            <h2>Editors</h2>
            <table className="list"><tbody>
              {people.map((p) => (
                <tr key={p.username}>
                  <td><b>{p.display_name || p.username}</b><br />
                    <span className="muted">{p.username}{!p.last_seen && " · has not signed in yet"}</span></td>
                  <td className="right">
                    <ConfirmButton small label="Remove" confirmText={`Remove ${p.username}?`}
                      url={`/api/departments/${dept.id}/members/${encodeURIComponent(p.username)}`} />
                  </td>
                </tr>
              ))}
              {people.length === 0 && <tr><td className="muted">Nobody yet.</td></tr>}
            </tbody></table>
            <AddMembersForm id={dept.id} suggestions={suggestions.map((u) => ({ username: u.username, display_name: u.display_name }))} />
          </section>
          <section className="card">
            <h2>Details</h2>
            <EditDepartmentForm id={dept.id} name={dept.name} color={cat?.color ?? "#0f6b62"} />
            <p className="muted">Category folder: <code>{dept.slug}</code></p>
            <p><ConfirmButton label="Delete department"
              confirmText="Members lose editing access; the guides stay on the site (admins only)."
              url={`/api/departments/${dept.id}`} after="/admin/departments" /></p>
          </section>
        </div>
      </>
    );
  }, (e) => <ErrorView error={e} />);
}
