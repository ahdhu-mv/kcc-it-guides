import Link from "next/link";
import { ErrorView } from "@/components/ErrorView";
import * as guides from "@/lib/guides";
import { guard } from "@/lib/page";
import { accessibleCategories } from "@/lib/session";

export const dynamic = "force-dynamic";

export default function Dashboard() {
  return guard("/", async ({ svc, session }) => {
    const { user } = session;
    const cards = await svc.repo.read((root) => {
      const depts = new Map(svc.db.departments().map((d) => [d.slug, d]));
      return Object.values(accessibleCategories(svc, user, root)).map((c) => ({
        ...c, count: guides.listGuides(root, c.slug).length, dept: depts.get(c.slug),
      }));
    });
    return (
      <>
        <h1>My guides</h1>
        {cards.length === 0 ? (
          <section className="card narrow">
            <p>You are signed in as <b>{user.name}</b>, but you are not in any department yet.</p>
            <p>Ask IT to add <code>{user.username}</code> to your department.</p>
          </section>
        ) : (
          <div className="grid">
            {cards.map((c) => (
              <Link key={c.slug} className="tile" href={`/c/${c.slug}`} style={{ ["--c" as string]: c.color }}>
                <span className="bar" />
                <h2>{c.name}</h2>
                <p className="muted">
                  {c.count} guide{c.count === 1 ? "" : "s"}
                  {c.dept ? ` · ${c.dept.member_count} editor${c.dept.member_count === 1 ? "" : "s"}` : ""}
                </p>
              </Link>
            ))}
          </div>
        )}
      </>
    );
  }, (e) => <ErrorView error={e} />);
}
