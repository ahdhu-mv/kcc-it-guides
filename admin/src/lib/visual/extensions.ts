/**
 * The editor's document model. It deliberately offers only what the site's
 * Markdown renderer supports (no tables, strike-through, underline, task lists),
 * so nothing can be created that the published page can't show.
 */
import Code from "@tiptap/extension-code";
import Document from "@tiptap/extension-document";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { ListItem } from "@tiptap/extension-list";
import StarterKit from "@tiptap/starter-kit";
import { mergeAttributes, type Extensions } from "@tiptap/core";
import { Callout, CalloutBody, CalloutTitle, Step, Steps, StepBody, StepTitle } from "./nodes";

// Guides often have **`bold code`**; by default the code mark would drop the bold.
const SiteCode = Code.extend({ excludes: "" });

const SiteDocument = Document.extend({ content: "(block | custom)+" });

// A list item holds one paragraph and optionally nested lists. (Python-Markdown,
// which builds the site, is strict about anything fancier.)
const SiteListItem = ListItem.extend({ content: "paragraph (bulletList | orderedList)*" });

/** Pictures are stored as ../images/<category>/<file>; inside the editor they are fetched from /img/. */
const IMAGE_RE = /^\.\.\/images\/(.+)$/;
export const SiteImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-orig") || el.getAttribute("src"),
      },
    };
  },
  renderHTML({ HTMLAttributes }) {
    const src = String(HTMLAttributes.src ?? "");
    const m = IMAGE_RE.exec(src);
    return ["img", mergeAttributes(HTMLAttributes, { src: m ? `/img/${m[1]}` : src, "data-orig": src })];
  },
}).configure({ inline: true, allowBase64: false });

export function editorExtensions(): Extensions {
  return [
    StarterKit.configure({
      document: false,
      listItem: false,
      strike: false,
      underline: false,
      link: false,
      code: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
    }),
    SiteDocument,
    SiteListItem,
    SiteCode,
    Link.configure({
      openOnClick: false,
      autolink: false,
      linkOnPaste: true,
      protocols: ["mailto"],
      HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
    }),
    SiteImage,
    Callout, CalloutTitle, CalloutBody, Steps, Step, StepTitle, StepBody,
  ];
}
