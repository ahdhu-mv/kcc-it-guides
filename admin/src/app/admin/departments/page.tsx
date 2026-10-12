import Link from "next/link";
import { NewDepartmentForm } from "@/components/DepartmentForms";
import { ErrorView } from "@/components/ErrorView";
import * as guides from "@/lib/guides";
import { guard } from "@/lib/page";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export default function Departments() {
  return guard("/admin/departments", async ({ svc, session }) => {
    requireAdmin(session.user);
    const { rows, free } = await svc.repo.read((root) => {
      const cmap = guides.categoryMap(root);
      const depts = svc.db.departments();
      const taken = new Set(depts.map((d) => d.slug));
      return {
        rows: depts.map((d) => ({ d, cat: cmap[d.slug], count: guides.listGuides(root, d.slug).length })),
        free: guides.loadCategories(root).filter((c) => !taken.has(c.slug)),
      };
    });
    return (
      <>
        <h1>Departments</h1>
        <p className="muted">Each department manages one category of guides. Members can edit only their own category.</p>
        <table className="list">
          <thead><tr><th>Department</th><th>Category</th><th>Guides</th><th>Editors</th><th /></tr></thead>
          <tbody>
            {rows.map(({ d, cat, count }) => (
              <tr key={d.id}>
                <td><b>{d.name}</b></td>
                <td>{cat ? <><span className="swatch" style={{ background: cat.color }} />{cat.slug}</> : <span className="tag warn">missing</span>}</td>
                <td>{count}</td><td>{d.member_count}</td>
                <td className="right"><Link className="btn small" href={`/admin/departments/${d.id}`}>Manage</Link></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="muted">No departments yet.</td></tr>}
          </tbody>
        </table>
        <section className="card narrow">
          <h2>New department</h2>
          <NewDepartmentForm free={free.map((c) => ({ slug: c.slug, name: c.name }))} />
        </section>
      </>
    );
  }, (e) => <ErrorView error={e} />);
}
