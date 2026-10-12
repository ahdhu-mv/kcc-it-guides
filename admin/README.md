# KCC Guides Admin

Department-based editing for the guides site. Staff sign in with their AD account (through Authelia),
edit only their own department's guides, and saving commits to the private GitHub repo as that person.
The public guides site picks changes up from GitHub exactly as before.

- **Editor:** Visual (word-processor style) or Markdown with a live preview, switch any time. The preview is
  rendered by the site's own `build.py`, so it matches what readers get.
- **Admins** (`ADMIN_USERS` and/or Authelia group `ADMIN_GROUP`) edit every category and manage departments and members.
- **Data:** departments, members and the activity log live in SQLite (`data/admin.db`). Guides stay in GitHub.
- **Stack:** Next.js + Node's built-in SQLite. Python is in the image only to run the site's renderer for previews.

## Deploy (docker02)
1. GitHub → repo → Settings → Deploy keys → add a **second** key with **Allow write access**
   (keep it separate from the read-only key used by the public site).
2. `mkdir -p ssh data`; put the private key at `ssh/id_ed25519` and a `known_hosts` containing GitHub's key for port 443
   (`ssh-keyscan -p 443 ssh.github.com > ssh/known_hosts`).
3. `cp .env.example .env` and set `REPO_URL`.
4. `docker compose up -d --build`, then `curl http://localhost:8000/healthz` → `ok`.
5. NPM proxy host `guides-admin.kcc.com` → `192.168.50.9:8000`, certificate must include that name. No Advanced block
   needed: the app asks Authelia itself.
6. Authelia: add an access rule for `guides-admin.kcc.com` (`one_factor`, or `two_factor`), then restart Authelia.
7. First admin is whoever is in `ADMIN_USERS`. Sign in, open **Departments**, create them, add people.

Back up `data/` (it holds `admin.db`). Run **one** instance only.

## Develop / test
```
npm ci
PYTHON_BIN=/path/to/python-with-the-site-requirements npm test   # 90+ tests, uses a throwaway git remote
npm run dev                                                      # needs the .env settings in the environment
```
