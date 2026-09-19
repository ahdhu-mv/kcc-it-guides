# Syncing this project with GitHub

This lets you edit guides directly on GitHub.com (or push commits from
anywhere) and have your live server pick them up automatically — no SSH
login to the server needed for day-to-day guide edits.

**How it works:** a small sidecar container (`git-sync`) runs alongside
the main site container. Every `GIT_SYNC_INTERVAL` seconds it runs `git
pull` in this project folder. Since `content/`, `categories.yaml`,
`templates/`, and `assets/` are already bind-mounted into the main
container, a pulled change lands on disk exactly like a manual edit — and
the main container's own file-watcher (the same one that's been rebuilding
the site on every local save) picks it up and rebuilds, same as always.
`git-sync` never touches Docker or the build itself — it only moves files.

## 1. Put this project on GitHub

On the Linux server, this folder needs to be an actual git clone, not a
zip extract — that's what `git pull` needs to work.

If you haven't already:

```bash
cd kcc-it-guides
git init
git add .
git commit -m "Initial commit"
```

Create a new repository on GitHub (**make it private** — these guides
likely mention internal extensions, staff ID formats, and other details
that shouldn't be public), then:

```bash
git remote add origin git@github.com:<your-username>/kcc-it-guides.git
git branch -M main
git push -u origin main
```

## 2. Create a read-only deploy key

Don't use your personal GitHub account's SSH key or a broadly-scoped
token for this — a **deploy key** is scoped to just this one repo, and
you'll set it read-only, so even if the server were ever compromised, the
worst it can do is read this repo, nothing else on your GitHub account.

On the server:

```bash
mkdir -p deploy/git-sync/ssh
ssh-keygen -t ed25519 -f deploy/git-sync/ssh/id_ed25519 -N ""
```

This creates two files: `id_ed25519` (private — stays on the server,
never committed) and `id_ed25519.pub` (public — goes into GitHub).

Print the public key and copy it:

```bash
cat deploy/git-sync/ssh/id_ed25519.pub
```

On GitHub: go to the repo → **Settings → Deploy keys → Add deploy key**.
Paste the public key, give it a name like "KCC server (read-only)", and
leave **"Allow write access" unchecked** — read-only is all `git pull`
needs.

## 3. Pin GitHub's host key

This lets `git` verify it's actually talking to GitHub, not something
impersonating it:

```bash
ssh-keyscan github.com >> deploy/git-sync/ssh/known_hosts
```

## 4. Set correct permissions

SSH refuses to use a private key that other users can read:

```bash
chmod 600 deploy/git-sync/ssh/id_ed25519
chmod 644 deploy/git-sync/ssh/id_ed25519.pub deploy/git-sync/ssh/known_hosts
```

## 5. Switch the remote to SSH (if it isn't already)

```bash
git remote set-url origin git@github.com:<your-username>/kcc-it-guides.git
```

## 6. Enable the sync service

Open `docker-compose.yml` and uncomment the `git-sync:` block near the
bottom, then:

```bash
docker compose up -d --build
```

## 7. Test it

Edit a guide directly on GitHub.com (or push a commit from your own
machine), then watch it arrive:

```bash
docker compose logs -f git-sync
```

You should see a line like `[git-sync] updated abc123 -> def456` within
`GIT_SYNC_INTERVAL` seconds (60 by default), followed shortly after by
the main container's own `[watch] rebuilt after change: ...` line.
Refresh the site and your edit should be there.

## Important: never hand-edit files on the server

Once this is running, treat GitHub as the only place guides get edited.
If you edit a file directly on the server outside of git (bypassing a
commit), `git pull` will refuse to overwrite your uncommitted change —
it fails safely rather than silently discarding it, but it will then
keep failing on every sync attempt until you resolve it:

```bash
docker compose logs git-sync   # see the conflict
git status                     # see what's locally modified
git checkout -- <file>         # discard the local change, OR
git add <file> && git commit   # keep it, commit it, then push
```

## Tuning the sync interval

`GIT_SYNC_INTERVAL` (seconds) in `docker-compose.yml` controls how often
it checks GitHub. 60 is a reasonable default — low enough to feel
responsive, high enough not to hammer GitHub's API. There's no reason to
go much below 30; git pulls aren't instant to begin with.
