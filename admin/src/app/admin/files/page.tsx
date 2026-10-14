import { ConfirmButton } from "@/components/ConfirmButton";
import { ErrorView } from "@/components/ErrorView";
import { humanSize, listStored } from "@/lib/attachments";
import { guard } from "@/lib/page";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export default function Files() {
  return guard("/admin/files", async ({ svc, session }) => {
    requireAdmin(session.user);
    const all = await svc.repo.read((root) => listStored(root));
    const unused = all.filter((s) => !s.usedBy.length);
    const used = all.filter((s) => s.usedBy.length);
    const total = unused.reduce((n, s) => n + s.size, 0);
    const link = (s: (typeof all)[number]) => (s.kind === "file" ? `/dl/${s.rel}` : `/img/${s.rel}`);
    return (
      <>
        <h1>Pictures and files</h1>
        <p className="muted">
          Pictures and attachments stay on the server even after a guide that used them is changed or deleted.
          Anything listed under <b>Not used</b> is not mentioned in any guide. The old copy is kept in the history folder when you delete it.
        </p>
        <h2>Not used ({unused.length}{unused.length ? `, ${humanSize(total)}` : ""})</h2>
        <table className="list">
          <thead><tr><th>Type</th><th>File</th><th>Size</th><th>Added</th><th /></tr></thead>
          <tbody>
            {unused.map((s) => (
              <tr key={s.kind + s.rel}>
                <td>{s.kind === "file" ? "Attachment" : "Picture"}</td>
                <td><a href={link(s)} target="_blank" rel="noopener">{s.rel}</a></td>
                <td>{humanSize(s.size)}</td><td className="nowrap">{s.modified}</td>
                <td className="right">
                  <ConfirmButton small label="Delete" confirmText={`Delete ${s.rel}?`}
                    url={`/api/stored/${s.kind === "file" ? "files" : "images"}/${s.rel}`} />
                </td>
              </tr>
            ))}
            {unused.length === 0 && <tr><td colSpan={5} className="muted">Nothing to clean up.</td></tr>}
          </tbody>
        </table>
        <h2>In use ({used.length})</h2>
        <table className="list">
          <thead><tr><th>Type</th><th>File</th><th>Size</th><th>Used in</th></tr></thead>
          <tbody>
            {used.map((s) => (
              <tr key={s.kind + s.rel}>
                <td>{s.kind === "file" ? "Attachment" : "Picture"}</td>
                <td><a href={link(s)} target="_blank" rel="noopener">{s.rel}</a></td>
                <td>{humanSize(s.size)}</td><td>{s.usedBy.join(", ")}</td>
              </tr>
            ))}
            {used.length === 0 && <tr><td colSpan={4} className="muted">None yet.</td></tr>}
          </tbody>
        </table>
      </>
    );
  }, (e) => <ErrorView error={e} />);
}
