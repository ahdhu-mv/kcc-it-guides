---
title: Setting up SSH key login between two Linux machines
description: Generate a key pair and authorize it on a remote server, including when password login is already disabled
updated: 2026-09-19
---

Key-based login replaces typing a password with a key pair: a private
key that stays on your own machine, and a public key you place on the
server. Once set up, `ssh user@host` logs you in without a password
prompt at all.

## Generate a key pair

::: steps
1. **Run ssh-keygen on your own machine**
   `ssh-keygen -t ed25519 -C "your_email@example.com"` — Ed25519 is the
   modern, recommended algorithm over the older RSA.

2. **Accept the default file location**
   Press Enter when it asks where to save the key, unless you
   specifically need multiple keys for different servers.

3. **Set a passphrase, or leave it blank**
   A passphrase adds protection if your own machine is ever
   compromised, at the cost of typing it each time you connect (unless
   you use an SSH agent). Either is fine — leave it blank for a fully
   passwordless connection.
:::

## Copy the public key to the server

If the server still allows password login, this is the easy path:

::: steps
1. **Run ssh-copy-id**
   `ssh-copy-id username@remote_host` from your own machine. It'll ask
   for that account's current password one last time to complete the
   transfer.

2. **If ssh-copy-id isn't available**
   Some minimal server images don't ship it. Use this instead, which
   does the same thing manually:
   `cat ~/.ssh/id_ed25519.pub | ssh username@remote_host "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"`
:::

::: callout If the server already has password login disabled
`ssh-copy-id` needs password access to work, so it won't help here.
You'll need another way in — a physical console, a cloud provider's web
terminal, an existing session you're already logged into, or IPMI/KVM
access — to paste the key manually instead. See the next section.
:::

## Adding the key manually

Use this when you have some other way into the server, but password
SSH login itself is already turned off:

::: steps
1. **Get your public key as text**
   On your own machine: `cat ~/.ssh/id_ed25519.pub`. Copy the full
   output — it's one long line starting with `ssh-ed25519`.

2. **Check whether authorized_keys already has something in it**
   On the server: `cat ~/.ssh/authorized_keys`. If it's empty or the
   file doesn't exist yet, go to step 3. If it already has a key in it,
   skip to step 4 — don't overwrite it, since that key likely belongs
   to another machine or administrator and deleting it would lock them
   out.

3. **Create it fresh**
   `mkdir -p ~/.ssh && chmod 700 ~/.ssh`, then paste your key in:
   `nano ~/.ssh/authorized_keys`, paste the key on its own line, save
   (`Ctrl+O`, Enter, `Ctrl+X`).

4. **Append to an existing file instead**
   Never use `nano` and delete what's there. Either open it, move to
   the very end, add a new line, and paste — or skip the editor
   entirely and run
   `echo "ssh-ed25519 AAAA...your key here..." >> ~/.ssh/authorized_keys`
   (the double `>>` matters — a single `>` would overwrite the whole
   file instead of adding to it).

5. **Fix the permissions**
   `chmod 700 ~/.ssh` and `chmod 600 ~/.ssh/authorized_keys`. SSH
   refuses to use a key file if the permissions are looser than this —
   it's one of the most common reasons this doesn't work on the first
   try.
:::

## Test it

From your own machine: `ssh username@remote_host`. You should land
straight in (or just get a passphrase prompt, if you set one) — no
password requested. If you instead see `Permission denied (publickey)`,
double-check the permissions from step 5 above before anything else;
that's the most common cause.

::: callout Test before you lock the door
Keep your current session open and confirm the key login actually works
in a second, separate connection first. If you disable password login
next and the key turns out not to work, you'll have locked yourself out
with no way back in except console/IPMI access.
:::

## Optional: disable password login entirely

Once key login is confirmed working, this closes off brute-force
password guessing as an attack path entirely:

::: steps
1. **Open the SSH daemon config**
   `sudo nano /etc/ssh/sshd_config` on the server.

2. **Find and change PasswordAuthentication**
   Set it to `PasswordAuthentication no`. Save and exit.

3. **Check the config for syntax errors before reloading**
   `sudo sshd -t` — this prints nothing if the file is valid. Fix
   anything it flags before continuing.

4. **Restart the SSH service**
   `sudo systemctl restart ssh`. Your existing session stays connected;
   only new connection attempts are affected.
:::
