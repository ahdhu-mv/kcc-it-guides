import { ErrorView } from "@/components/ErrorView";
import { guard } from "@/lib/page";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export default function Audit() {
  return guard("/admin/audit", async ({ svc, session }) => {
    requireAdmin(session.user);
    const rows = svc.db.auditRecent();
    return (
      <>
        <h1>Recent activity</h1>
        <table className="list">
          <thead><tr><th>When (UTC)</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
          <tbody>
            {rows.map((r) => <tr key={r.id}><td className="nowrap">{r.ts}</td><td>{r.username}</td><td>{r.action}</td><td>{r.detail}</td></tr>)}
            {rows.length === 0 && <tr><td colSpan={4} className="muted">Nothing yet.</td></tr>}
          </tbody>
        </table>
      </>
    );
  }, (e) => <ErrorView error={e} />);
}
