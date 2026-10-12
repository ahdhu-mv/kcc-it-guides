/**
 * The two site-specific blocks, as editor nodes.
 *
 *   ::: callout Title        callout      = title + one line of text
 *   Body text                              (the site renders the body as plain text
 *   :::                                     with `code` chips, not full Markdown)
 *
 *   ::: steps                steps        = a numbered list of steps,
 *   1. **Title**                            each a bold title + plain text
 *      Body
 *   :::
 *
 * Both only live at the top level of a guide (the site's builder only
 * recognises them there), which the document schema enforces.
 */
import { mergeAttributes, Node } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/core";

const part = (name: string, cls: string, marks: string, tag = "div") =>
  Node.create({
    name,
    content: "text*",
    marks,
    defining: true,
    selectable: false,
    parseHTML: () => [{ tag: `${tag}[data-kcc="${name}"]` }],
    renderHTML: ({ HTMLAttributes }) =>
      [tag, mergeAttributes(HTMLAttributes, { "data-kcc": name, class: cls }), 0],
  });

export const CalloutTitle = part("calloutTitle", "kcc-callout-title", "");
export const CalloutBody = part("calloutBody", "kcc-callout-body", "code");
export const StepTitle = part("stepTitle", "kcc-step-title", "");
export const StepBody = part("stepBody", "kcc-step-body", "code");

function insertAfterTopBlock(editor: Editor, json: object, focusInside = 1): boolean {
  const { $from } = editor.state.selection;
  // Typing into an empty paragraph: put the block there instead of leaving a blank line behind.
  const replaceEmpty = $from.depth >= 1 && $from.node(1).type.name === "paragraph" && $from.node(1).content.size === 0;
  const pos = replaceEmpty ? $from.before(1) : $from.depth >= 1 ? $from.after(1) : $from.pos;
  const chain = editor.chain();
  if (replaceEmpty) chain.deleteRange({ from: pos, to: $from.after(1) });
  return chain.insertContentAt(pos, json).focus().setTextSelection(pos + focusInside).run();
}

export const calloutJSON = (title = "Note", body = "") => ({
  type: "callout",
  content: [
    { type: "calloutTitle", content: title ? [{ type: "text", text: title }] : [] },
    { type: "calloutBody", content: body ? [{ type: "text", text: body }] : [] },
  ],
});

export const stepJSON = (title = "", body = "") => ({
  type: "step",
  content: [
    { type: "stepTitle", content: title ? [{ type: "text", text: title }] : [] },
    { type: "stepBody", content: body ? [{ type: "text", text: body }] : [] },
  ],
});

export const stepsJSON = () => ({ type: "steps", content: [stepJSON("First step"), stepJSON("Second step")] });

export function insertCallout(editor: Editor): boolean {
  return insertAfterTopBlock(editor, calloutJSON(), 2);
}
export function insertSteps(editor: Editor): boolean {
  return insertAfterTopBlock(editor, stepsJSON(), 3);
}

const ancestorOf = (editor: Editor, name: string) => {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === name) return d;
  return -1;
};

export function insideCustom(editor: Editor): "callout" | "steps" | null {
  if (ancestorOf(editor, "callout") > 0) return "callout";
  if (ancestorOf(editor, "steps") > 0) return "steps";
  return null;
}

/** Move out of a note box / steps list into a fresh paragraph after it (used before inserting block content). */
export function leaveCustomBlock(editor: Editor): void {
  const kind = insideCustom(editor);
  if (!kind) return;
  const d = ancestorOf(editor, kind);
  const pos = editor.state.selection.$from.after(d);
  editor.chain().insertContentAt(pos, { type: "paragraph" }).setTextSelection(pos + 1).run();
}

export function removeEnclosing(editor: Editor, name: "callout" | "steps"): boolean {
  const d = ancestorOf(editor, name);
  if (d < 0) return false;
  const { $from } = editor.state.selection;
  const from = $from.before(d);
  const to = $from.after(d);
  return editor.chain().focus().deleteRange({ from, to }).run();
}

export function addStep(editor: Editor): boolean {
  const d = ancestorOf(editor, "step");
  if (d < 0) return false;
  const { $from } = editor.state.selection;
  const pos = $from.after(d);
  return editor.chain().insertContentAt(pos, stepJSON()).focus().setTextSelection(pos + 2).run();
}

export function removeStep(editor: Editor): boolean {
  const d = ancestorOf(editor, "step");
  if (d < 0) return false;
  const { $from } = editor.state.selection;
  const steps = $from.node(d - 1);
  if (steps.childCount <= 1) return removeEnclosing(editor, "steps");
  return editor.chain().focus().deleteRange({ from: $from.before(d), to: $from.after(d) }).run();
}

export const Callout = Node.create({
  name: "callout",
  group: "custom",
  content: "calloutTitle calloutBody",
  defining: true,
  isolating: true,
  parseHTML: () => [{ tag: 'div[data-kcc="callout"]' }],
  renderHTML: ({ HTMLAttributes }) =>
    ["div", mergeAttributes(HTMLAttributes, { "data-kcc": "callout", class: "kcc-callout" }), 0],
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection;
        const name = $from.parent.type.name;
        if (name === "calloutTitle") {
          return editor.commands.setTextSelection($from.after() + 1);
        }
        if (name === "calloutBody") {
          const pos = $from.after($from.depth - 1);
          return editor.chain().insertContentAt(pos, { type: "paragraph" }).setTextSelection(pos + 1).run();
        }
        return false;
      },
    };
  },
});

export const Step = Node.create({
  name: "step",
  content: "stepTitle stepBody",
  defining: true,
  isolating: true,
  parseHTML: () => [{ tag: 'li[data-kcc="step"]' }],
  renderHTML: ({ HTMLAttributes }) =>
    ["li", mergeAttributes(HTMLAttributes, { "data-kcc": "step", class: "kcc-step" }), 0],
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection;
        const name = $from.parent.type.name;
        if (name === "stepTitle") {
          return editor.commands.setTextSelection($from.after() + 1);
        }
        if (name === "stepBody") {
          const stepDepth = $from.depth - 1;
          const step = $from.node(stepDepth);
          const steps = $from.node(stepDepth - 1);
          const empty = step.textContent.length === 0;
          if (empty && steps.childCount > 1) {
            // An empty step + Enter leaves the list.
            const from = $from.before(stepDepth);
            const to = $from.after(stepDepth);
            const afterSteps = $from.after(stepDepth - 1) - (to - from);
            return editor.chain().deleteRange({ from, to })
              .insertContentAt(afterSteps, { type: "paragraph" })
              .setTextSelection(afterSteps + 1).run();
          }
          const pos = $from.after(stepDepth);
          return editor.chain().insertContentAt(pos, stepJSON()).setTextSelection(pos + 2).run();
        }
        return false;
      },
    };
  },
});

export const Steps = Node.create({
  name: "steps",
  group: "custom",
  content: "step+",
  defining: true,
  isolating: true,
  parseHTML: () => [{ tag: 'ol[data-kcc="steps"]' }],
  renderHTML: ({ HTMLAttributes }) =>
    ["ol", mergeAttributes(HTMLAttributes, { "data-kcc": "steps", class: "kcc-steps" }), 0],
});

export { TextSelection };
