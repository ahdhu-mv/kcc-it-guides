# KCC Guides Admin

Department-based editing for the guides site. Staff sign in with their AD account (through Authelia),
edit only their own department's guides, and saving writes the guide into the site's folder (or, in GitHub mode, commits to the repo as that person).
The public site rebuilds itself within seconds.

- **Editor:** Visual (word-processor style) or Markdown with a live preview, switch any time. The preview is
  rendered by the site's own `build.py`, so it matches what readers get.
- **Admins** (`ADMIN_USERS` and/or Authelia group `ADMIN_GROUP`) edit every category and manage departments and members.
- **Data:** departments, members and the activity log live in SQLite (`data/admin.db`). Guides are files in the site folder.
- **Stack:** Next.js + Node's built-in SQLite. Python is in the image only to run the site's renderer for previews.

## Deploy (docker02, local files, no GitHub)
1. Run the app from `admin/` inside the site's project folder (for example `/opt/kcc-it-guides/admin`). It mounts the
   folder above it as `/site` and only edits `content/` and `config/`.
2. Stop the GitHub sync container, or it could overwrite edits: `docker compose stop git-sync` in the site folder
   (and remove/comment the `git-sync` service so it stays off).
3. `cp .env.example .env`; set `APP_UID`/`APP_GID` to the owner of the site folder (`id -u`, `id -g`). `mkdir -p data`.
4. `docker compose up -d --build`, then `curl http://localhost:8000/healthz` -> `ok`.
5. NPM proxy host `guides-admin.kcc.com` -> `192.168.50.9:8000`, certificate must include that name. No Advanced block
   needed: the app asks Authelia itself.
6. Authelia: add an access rule for `guides-admin.kcc.com` (`one_factor`, or `two_factor`), then restart Authelia.
7. First admin is whoever is in `ADMIN_USERS`. Sign in, open **Departments**, create them, add people.

**Undo a mistake:** every change keeps the old copy of each file it touched in `data/history/<time>-<person>/before/`
with a `changes.txt` (A = added, M = modified, D = deleted). Copy the old file back into `content/` or `config/`.
The newest 500 changes are kept.

**Back up** `data/` (departments, members, history) **and** the site's `content/` and `config/` folders. Run **one** instance only.

*GitHub mode:* unset `SITE_DIR`, set `REPO_URL` and a write deploy key in `./ssh/` (see `.env.example`); saves are then
commits pushed as the editor.

## Develop / test
```
npm ci
PYTHON_BIN=/path/to/python-with-the-site-requirements npm test   # 90+ tests, uses a throwaway git remote
npm run dev                                                      # needs the .env settings in the environment
```
