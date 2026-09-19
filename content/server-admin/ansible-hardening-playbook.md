---
title: How the web server hardening playbook works
description: What each phase of the site.yml Ansible playbook does, and the SSH lockout risk to check before running it
updated: 2026-09-19
---

`site.yml` sets up a hardened, containerized, reverse-proxied app hosting
server with automatic HTTPS — the same playbook runs whether it's a brand
new box or a box that's already configured, and it's built to be safely
re-run.

::: callout Check who you're logged in as before running this
Phase 1 disables root SSH login and password authentication entirely. If
you're currently SSHed in as `root`, this playbook will lock root out
the moment it finishes — you'll only be able to log back in as the
`deployer` account it creates, using an SSH key, not a password. Confirm
this works before you disconnect your current session.
:::

## Before you run this

::: steps
1. **Check which user you're connected as**
   `whoami` on the server. If it says `root`, read the rest of this
   callout section carefully before continuing.

2. **Confirm the deploy user's key is correct**
   The playbook authorizes whatever public key `deploy_user_ssh_pubkey_file`
   points to (in `web_servers.yml`) for the new `deployer` account. Make
   sure that's actually a key you hold the private half of.

3. **Do a dry run first**
   `ansible-playbook site.yml --check --diff` shows exactly what would
   change without touching anything. Worth doing on any box that isn't
   brand new.

4. **Run it for real**
   `ansible-playbook site.yml` — no tags needed on a fresh box; it runs
   every phase in order.
:::

## What each phase does

### Phase 0 — base packages

Installs the handful of packages later phases depend on (`curl`,
`gnupg`, `ca-certificates`, `python3-pip`, etc.) — nothing specific to
this stack yet.

### Phase 1 — deploy user and SSH hardening

Creates the `deployer` account, authorizes your SSH key for it, then
locks the front door: root SSH login and password authentication both
get disabled (see the warning above). It also turns off several SSH
features this box has no use for — `X11Forwarding`, `AllowTcpForwarding`,
`AllowAgentForwarding`, `TCPKeepAlive` — and tightens brute-force
resistance directly in `sshd_config` (`MaxAuthTries 3`, `MaxSessions 2`,
`ClientAliveCountMax 2`), plus verbose SSH logging.

### Phase 2 — firewall and intrusion prevention

UFW is set to default-deny on incoming connections, with only the ports
listed in `firewall_allowed_tcp_ports` (normally just 22, 80, 443)
explicitly allowed. `fail2ban` is installed and its `sshd` jail enabled
(disabled by default on a stock Ubuntu install) — 5 failed attempts
within 10 minutes gets an IP banned for an hour.

### Phase 3 — Docker engine

Installs Docker from the real `download.docker.com` repository, not
whatever version Ubuntu's own package archive happens to carry. Also
sets a log-rotation limit (`docker_log_max_size`, `docker_log_max_file`
in `web_servers.yml`) so a noisy container's logs can't quietly fill the
disk over time — Docker doesn't rotate container logs by default.

## Re-running just one part

Once a box is already set up, there's no need to run every phase again:

```bash
ansible-playbook site.yml --tags apps            # redeploy app containers only
ansible-playbook site.yml --tags tls-issue,tls-finalize   # pick up a new domain
```

## Key settings in web_servers.yml

- **`web_apps`** — the list of applications this server hosts. Each
  entry is either `managed: true` (this playbook runs the container for
  you — needs `image`, optionally `mem_limit`/`cpus`/`port`) or
  `managed: false` (the client runs their own container, joined to the
  `app-network` Docker network under the exact name given).
- **`ssl_admin_email`** — see the separate guide on the Let's Encrypt
  automation for what this actually does and whether it needs to be a
  real inbox.
- **`letsencrypt_staging`** — keep this `true` while testing a new
  domain; flip to `false` only once the whole flow is confirmed working.
- **`backup_*` settings** — what gets backed up, where, and for how long.
- **Monitoring hooks** (`healthcheck_backup_ping_url`,
  `healthcheck_renewal_ping_url`, `uptimerobot_api_key`) — all optional;
  leave blank to skip. When set, they give an early warning if a cron
  job silently stops running, or if a site goes down, rather than
  finding out the hard way.
