# KCC IT Guides

A static internal knowledge base for the IT Section. You write guides as
plain Markdown files; a small build script turns them into the full site —
homepage, search, categories, and one page per guide — automatically. There
is no database and no login-protected editor: adding a guide is adding a
file.

## How it's organised

```
kcc-it-guides/
├── categories.yaml          ← the 4 categories shown on the homepage
├── content/
│   ├── passwords-accounts/  ← one .md file per guide
│   ├── applications/
│   ├── hardware-network/
│   └── access-security/
├── templates/                ← page layout (edit rarely)
├── assets/css/style.css      ← visual design (edit rarely)
├── build.py                  ← generates dist/ from content/ (one-shot)
├── watch.py                  ← watches for changes, calls build.py automatically
├── entrypoint.sh              ← container startup: build once, then nginx + watch.py
├── Dockerfile, docker-compose.yml, nginx.conf
└── dist/                     ← generated output — never edit by hand
```

## Adding a new guide

1. Pick the right folder under `content/` (or add a new one — see below).
2. Create a new `.md` file, e.g. `content/applications/booking-a-room.md`:

   ```markdown
   ---
   title: Booking a meeting room
   description: Reserve a room through the council calendar system
   updated: 2026-09-18
   ---

   Short intro paragraph explaining what this guide is for.

   ::: callout Before you start
   Anything the reader needs to know or have ready, in one or two sentences.
   :::

   ## A section heading

   ::: steps
   1. **First step title**
      Explanation of the step. Use `backticks` for anything the reader
      types or clicks literally.

   2. **Second step title**
      More explanation.
   :::

   ## Another section, if needed

   Regular paragraph text works too — not everything has to be numbered
   steps. Only use `::: steps` for things that are genuinely sequential.
   ```

3. Rebuild (see below) and the guide appears on the homepage automatically,
   under the right category, sorted newest-updated first — no other file
   needs to be touched.

To remove a guide, delete its `.md` file and rebuild.

## Adding a new category

Add an entry to `categories.yaml`:

```yaml
- slug: onboarding
  name: New staff onboarding
  color: "#6a4c93"
```

Then create the matching folder: `content/onboarding/`. It'll show up on
the homepage next time you rebuild, even before it has any guides in it —
well, actually, empty categories are skipped, so add at least one guide.

## Guides without a category

Don't want to decide on a category yet, or the guide is a one-off that
doesn't fit anywhere? Drop the `.md` file directly in `content/` instead of
a subfolder:

```
content/
└── printer-toner-locations.md   ← no category folder
```

It shows up automatically in a "General" section on the homepage. You can
always move it into a proper category folder later — nothing else needs to
change, since the homepage is generated fresh from whatever's actually
there each time.

## Building and running

**On your Docker host** (this is the real deployment):
```bash
docker compose up -d --build
```
This builds the image once and serves the site with nginx on port 8090
(change the `ports:` line in `docker-compose.yml` if that's taken, or
attach it to an existing reverse-proxy network instead — see the
comments in that file).

**After that first `--build`, you don't need to rebuild again.** The
container watches `content/`, `categories.yaml`, `templates/` and
`assets/` (all bind-mounted from this folder — see `volumes:` in
`docker-compose.yml`) and rebuilds the site itself, in the background,
usually within about 2 seconds of any change. Add a `.md` file, edit
one, or delete one, save it, and refresh the browser — that's the whole
workflow. You only need `docker compose up -d --build` again if you
change the Dockerfile, `build.py`, `requirements.txt`, or `nginx.conf`
themselves.

The watcher checks for changes by polling the filesystem every 1.5
seconds by default, rather than relying on OS file-change events —
those events don't reliably cross Docker Desktop's bind-mount boundary
on Windows or Mac, so polling is the setting that actually works
everywhere. If you want it to check more or less often, set
`WATCH_POLL_INTERVAL` (in seconds) as an environment variable on the
`it-guides` service in `docker-compose.yml`.

**Locally, without Docker** (useful while writing, if you don't want to
touch Docker at all):
```bash
pip install -r requirements.txt
python3 watch.py &          # rebuilds dist/ automatically on every save
python3 -m http.server -d dist 8000
```
Or, for a one-off build with no watching: `python3 build.py`.

## Formatting reference

- `## Heading` — section heading (also becomes an entry in the right-hand
  "On this page" list automatically)
- `` `text` `` — inline code / literal text the reader types or clicks
- `::: callout Title ... :::` — the highlighted box for warnings or
  prerequisites
- `::: steps ... :::` — numbered instructions; each item is
  `N. **Title**` followed by an indented explanation line
- Plain paragraphs — just write normally

## Editing guides from GitHub instead of the server

Want to edit guides on GitHub.com (or push from your own machine) and
have the live site update on its own, without logging into the server?
See `deploy/GITHUB_SYNC.md` — it's a one-time setup, after which editing
a guide is just a normal git commit.

## What's deliberately not included

- **No login-based editor.** Anyone who can edit files on the Docker host
  (or push to wherever this repo lives) can add a guide. If you later want
  non-technical staff contributing directly through a browser, that's a
  bigger tool (BookStack, Outline) — this project trades that away for
  being simple, fast, and exactly the look you asked for.
- **No full-text fuzzy search** — the homepage search matches guide titles
  and descriptions as you type, which covers the realistic case of someone
  typing "password" or "printer." Nothing indexes guide body text.
