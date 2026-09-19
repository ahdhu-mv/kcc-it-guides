---
title: Resetting the Nginx Proxy Manager admin password
description: Recover access when the NPM admin login is lost, via its SQLite database
updated: 2026-09-19
---

Nginx Proxy Manager (NPM) has no built-in "forgot password" flow. If the
admin login is lost, the fix is to edit its database directly to force it
back to the default admin account, log in, then restore your real account.

::: callout Do this in one sitting
Between the reset step and logging back in, NPM briefly falls back to a
publicly-known default login (`admin@example.com` / `changeme`). Don't
leave that window open — go straight through steps 1 to 4 without a long
gap, and don't skip the final restore step.
:::

This assumes NPM is using its default SQLite database (true for our
setup) — not a separate MySQL/MariaDB container.

## Reset

::: steps
1. **Open a shell inside the NPM container**
   `docker exec -it npm sh` (replace `npm` with the actual container name
   if it's different — check with `docker ps`).

2. **Install the sqlite3 CLI if it's missing**
   Our NPM image doesn't ship it by default. If `sqlite3 /data/database.sqlite`
   says `sqlite3: not found`, run `apt-get update && apt-get install -y sqlite3`
   first, then try again.

3. **Hide the existing user account**
   Inside the sqlite3 prompt: `UPDATE user SET is_deleted=1;` — the
   semicolon at the end is required. If you forget it, sqlite3 just sits
   there showing a `...>` prompt waiting for you to finish the statement;
   type `;` on its own and press enter to close it out. Then run `.exit`
   to leave sqlite3, and `exit` again to leave the container shell.

4. **Restart the container**
   `docker restart npm` from the host, not from inside the container.
:::

## Log in and restore

::: steps
1. **Log in with the temporary default account**
   Open the NPM web UI and sign in with `admin@example.com` / `changeme`.
   Your existing proxy hosts are still there — they're untouched by this,
   only the user table was affected.

2. **Set a new password on your real account**
   Go to `Users`, find your original account (it's hidden from the list
   right now, but still exists), and if it doesn't show up yet, continue
   to the next step first, then come back.

3. **Un-hide your original account**
   Back in the container shell (`docker exec -it npm sh`, then
   `sqlite3 /data/database.sqlite`), run `UPDATE user SET is_deleted=0;`
   followed by `.exit` and `exit`. Refresh the NPM web UI.

4. **Reset your real account's password and clean up**
   In `Users`, click your original account, set a new password. Then
   delete the temporary `admin@example.com` account so it isn't sitting
   there as a known-credentials backdoor.
:::
