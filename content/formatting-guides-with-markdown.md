---
title: Formatting guides with Markdown
description: A reference for every formatting option available when writing a guide
updated: 2026-09-19
---

Every guide on this site is written as a plain `.md` file. Most of it is
just normal Markdown, plus two custom blocks — `callout` and `steps` — built
specifically for this project. This guide shows what each one looks like
and how to write it.

## The top of every file: frontmatter

Before any actual content, every guide starts with a block bounded by
`---` lines. Three fields go in it:

```yaml
---
title: Reset your network password
description: Self-service reset when you're locked out or have forgotten it
updated: 2026-09-19
---
```

- `title` — the page's heading, browser tab title, and the link text
  shown on the homepage.
- `description` — the one-line summary shown under the title on the
  homepage listing.
- `updated` — a date as `YYYY-MM-DD`, written exactly like that with no
  quotes around it. Guides are sorted newest-first within their category
  by this date, so update it whenever you make a real edit.

::: callout This block is required
A file missing this `---`-delimited block at the very top won't build —
the site generator skips it and logs an error rather than publish a
broken page. Copy the shape above, then write the actual guide content
underneath it.
:::

## Headings

Use `##` for a section heading. Each one automatically becomes an entry in
the "On this page" list on the right of the article, so break a long guide
into a few of these rather than writing one continuous wall of text.

```markdown
## Setting up the app
```

Don't use a single `#` — that's reserved for the guide title itself, which
comes from `title:` in the frontmatter, not from the body.

## Plain text formatting

Regular paragraphs just work. Within a paragraph you can use:

- **Bold** with `**double asterisks**`
- *Italics* with `*single asterisks*`
- Inline code like `systemctl restart nginx` with backticks
- [Links](https://example.com) with `[text](url)`

## Lists

Bulleted and numbered lists both work normally, for anything that's a
plain list rather than a set of instructions someone follows in order:

```markdown
- First item
- Second item
- Third item
```

- First item
- Second item
- Third item

Use a numbered list like this for reference information ("supported file
types are: ...") — use a `::: steps` block instead (below) when the reader
needs to actually **do** something step by step.

## Code blocks

For more than one line of code or a command, use a fenced code block —
three backticks, the content, then three backticks again:

````markdown
```
net user /domain
```
````

```
net user /domain
```

Add a language name right after the opening backticks to get syntax
highlighting — colored keywords, strings, and comments:

````markdown
```bash
sudo systemctl restart nginx
```
````

```bash
sudo systemctl restart nginx
```

This works for any language Pygments recognizes — `bash`, `python`,
`powershell`, `yaml`, `json`, and dozens more. Leave the language off (as
in the plain example above) when you just want a plain box with no
coloring.

## Callout boxes

Use this for anything the reader needs to know before they start, or a
warning that doesn't fit naturally into a numbered step. Write it like
this:

```markdown
::: callout Before you start
Anything important the reader should know up front.
:::
```

::: callout Before you start
Anything important the reader should know up front.
:::

Keep it short — a sentence or two. If you need more than that, it's
probably regular body text instead, not a callout.

## Steps — the numbered walkthrough

This is the one people notice first: a clean, numbered sequence for actual
step-by-step instructions. Write each step as a numbered list item with a
**bold title**, followed by an indented explanation:

```markdown
::: steps
1. **Open the settings menu**
   Click the gear icon in the top-right corner.

2. **Find the network tab**
   It's the third item in the left sidebar.
:::
```

::: steps
1. **Open the settings menu**
   Click the gear icon in the top-right corner.

2. **Find the network tab**
   It's the third item in the left sidebar.
:::

A few rules that keep these rendering correctly:

- The number and the bold title must be on the same line: `1. **Title**`
- The explanation goes on the line(s) directly under it, indented by a
  few spaces
- Use backticks inside a step for anything the reader clicks or types
  literally, e.g. `` `Reset password` `` or `` `KCC-0142` `` — it renders
  as a highlighted code chip, same as elsewhere on the site
- Leave a blank line between one step and the next

## Images

Put image files in `content/images/`, then reference one from any guide,
in any category, with:

```markdown
![Alt text describing the image](../images/your-file.png)
```

The `../` matters — every guide page lives one folder inside the site
(e.g. `server-admin/some-guide.html`), and `content/images/` sits next
to those category folders, not inside them, so the path has to step
back out first. This works the same way regardless of which category
the guide is in.

Here's a real one, actually stored in `content/images/` and referenced
exactly this way, so you're looking at genuinely working output, not just
a description of it:

![A simple diagram showing a guide file flowing through the build script into a live guide page](../images/build-flow-example.svg)

PNG, JPG, and SVG all work. Keep an eye on file size for anything that
isn't a simple diagram — a large photo slows the page down for whoever's
reading it.

## Putting it together

Most real guides use a mix of all of this: a plain intro paragraph, maybe
a callout for a prerequisite, one or two `## Section` headings, and a
`::: steps` block under each section for the actual instructions. Look at
any existing guide in `content/` for a full working example — "Reset your
network password" uses nearly everything covered on this page.
