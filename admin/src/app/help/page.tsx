import { ErrorView } from "@/components/ErrorView";
import { guard } from "@/lib/page";

export const dynamic = "force-dynamic";

export default function Help() {
  return guard("/help", async ({ svc }) => (
    <>
      <h1>Help</h1>
      <section className="card narrow prose">
        <h2>Writing a guide</h2>
        <p>Pick your department on <a href="/">My guides</a>, choose <b>New guide</b>, write, and press <b>Save and publish</b>. The guide appears on the guides site within about a minute.</p>
        <h2>Visual or Markdown</h2>
        <p><b>Visual</b> works like a word processor: type, then use the buttons to make headings, lists, links, pictures, <b>Note boxes</b> and numbered <b>Steps</b>. <b>Markdown</b> shows the underlying text with a live preview of the published page. You can switch between them at any time. Some older guides use formatting only Markdown can keep exactly; those open in Markdown automatically.</p>
        <h2>Note boxes and steps</h2>
        <p>A note box has a title and one short text. Steps are a numbered list where each step has a bold title and a short explanation. Press Enter in a step to add the next one; press Enter on an empty step to finish the list. Inside these two blocks only plain text and <code>code</code> chips are supported, the same as on the site.</p>
        <h2>Pictures</h2>
        <p>Press <b>Picture</b>, or paste or drag a picture into the text. PNG, JPG, GIF or WebP up to 5 MB.</p>
        <h2>Files to download</h2>
        <p>Press <b>Attach file</b>, or drag a file into the text. PDF, Word, Excel, PowerPoint, text and CSV files up to 10 MB.
          A link with the file name, type and size is added where the cursor is. Files with macros are not accepted.</p>
        <h2>Two people editing</h2>
        <p>If someone saved the same guide while you were editing, you are warned instead of overwriting their work.</p>
        <h2>Mistakes</h2>
        <p>Every change is kept in history. IT can restore an earlier version.</p>
        <p className="muted">Site: <a href={svc.cfg.guidesSiteUrl} target="_blank" rel="noopener">{svc.cfg.guidesSiteUrl}</a></p>
      </section>
    </>
  ), (e) => <ErrorView error={e} />);
}
