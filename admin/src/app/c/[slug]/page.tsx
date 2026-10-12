import Link from "next/link";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ErrorView } from "@/components/ErrorView";
import * as guides from "@/lib/guides";
import { guard } from "@/lib/page";
import { getCategory } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function CategoryPage(
  { params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ saved?: string; deleted?: string }> },
) {
  const { slug } = await params;
  const q = await searchParams;
  return guard(`/c/${slug}`, async ({ svc, session }) => {
    const { user } = session;
    const { cat, items } = await svc.repo.read((root) => ({
      cat: getCategory(svc, user, root, slug), items: guides.listGuides(root, slug),
    }));
    const dept = svc.db.departmentBySlug(slug);
    return (
      <>
        <p className="crumb"><Link href="/">My guides</Link> / {cat.name}</p>
        {q.saved && <p className="flash">Saved and published. It appears on the guides site within about a minute.</p>}
        {q.deleted && <p className="flash">The guide was deleted.</p>}
        <div className="head">
          <h1><span className="swatch" style={{ background: cat.color }} />{cat.name}</h1>
          <Link className="btn" href={`/c/${slug}/new`}>+ New guide</Link>
        </div>
        {user.isAdmin && dept && (
          <p className="muted">Department: <Link href={`/admin/departments/${dept.id}`}>{dept.name}</Link></p>
        )}
        {items.length === 0 ? (
          <section className="card"><p>No guides here yet. Start with <Link href={`/c/${slug}/new`}>a new guide</Link>.</p></section>
        ) : (
          <table className="list">
            <thead><tr><th>Guide</th><th>Updated</th><th /></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.slug}>
                  <td>
                    <b>{it.title}</b>{it.broken && <> <span className="tag warn">needs fixing</span></>}
                    <br /><span className="muted">{it.description}</span>
                  </td>
                  <td className="nowrap">{it.updated}</td>
                  <td className="right">
                    <span className="row end">
                      <Link className="btn small" href={`/c/${slug}/g/${it.slug}/edit`}>Edit</Link>
                      <ConfirmButton small label="Delete" confirmText={`Delete “${it.title}”?`}
                        url={`/api/guides/${slug}/${it.slug}`} after={`/c/${slug}?deleted=1`} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </>
    );
  }, (e) => <ErrorView error={e} />);
}
