---
title: How the Let's Encrypt certificate automation works
description: The idempotent, conditional cert-issuance logic, staging vs production, and what the admin email actually does
updated: 2026-09-19
---

Certificates are requested through two Ansible tasks working together —
one that checks what already exists, and one that only acts on what's
actually missing. This is what stops the automation from hammering
Let's Encrypt's rate limits on every re-run.

## The check

The first task looks for an existing certificate on disk for every app
in `web_apps`:

```yaml
- name: Check which domains already have a certificate
  ansible.builtin.stat:
    path: "/etc/letsencrypt/live/{{ item.domain }}/fullchain.pem"
  loop: "{{ web_apps }}"
  register: cert_check
```

`ansible.builtin.stat` just inspects a file path — it doesn't change
anything. `register: cert_check` is the important part: it saves
whether each domain's certificate file exists, for the next task to act on.

## The conditional issuance

The second task loops over those results and only requests a
certificate where one is actually missing:

```yaml
- name: Request certificates only for domains that don't have one yet
  community.docker.docker_container:
    image: "certbot/certbot:v2.11.0"
    loop: "{{ cert_check.results }}"
    when:
      - not item.stat.exists
      - "'.local' not in item.item.domain"
```

Both `when:` conditions have to be true for a domain to get a request:

- **`not item.stat.exists`** — no certificate file was found for it in
  the check above.
- **`'.local' not in item.item.domain`** — it isn't an internal-only
  `.local` domain. Let's Encrypt can only issue certificates for
  domains it can publicly verify, so `.local` addresses are always
  skipped, never requested.

Certbot itself runs as a temporary Docker container (not installed
directly on the host), with `/etc/letsencrypt` mounted so the issued
certificate lands on the real filesystem, and `cleanup: true` so the
container doesn't linger afterward.

## Why re-running this is safe

The first time, a domain's certificate file doesn't exist, so it gets
requested. Every time after that, the check finds the file already
sitting there, `not item.stat.exists` becomes false, and that domain is
skipped entirely. Re-running the whole playbook — or just this task, via
`--tags tls-issue,tls-finalize` — never re-requests a certificate that
already exists.

## Staging vs production

`letsencrypt_staging: true` (in `web_servers.yml`) makes every request
go to Let's Encrypt's staging environment instead of production —
staging allows far more requests per domain, so mistakes while testing
a new domain don't burn into the real, much stricter production limit
(5 duplicate certificates per domain per week). Keep it `true` until
the whole flow is confirmed working for a domain, then flip to `false`
to get a real, browser-trusted certificate.

## What ssl_admin_email is actually for

It's a plain string handed to Let's Encrypt when a certificate is
requested — nothing more. It isn't authenticated, verified, or confirmed
in any way; a typo'd or fake address won't stop a certificate from being
issued or from working correctly. What it actually does:

- **Expiration warnings** — certificates last 90 days, and this address
  gets an email at 20, 10, and 1 day before one expires, in case the
  automated renewal has silently broken.
- **Security and policy notices** — Let's Encrypt's own contact point
  for anything affecting the account.
- **`--no-eff-email`** in the Certbot command keeps this address off
  the EFF's separate mailing list, so it isn't opted into any marketing.

::: callout Does the email need to be real?
Not for the certificate itself to work — it'll be issued and function
correctly either way. But if it's fake and the automated renewal
happens to break, there's no early warning: the site just goes down
silently the day the certificate expires, with nobody notified in
advance. Use a real, actively-monitored inbox — a shared IT alias like
`it@kcc.mv` is a good fit, since it doesn't depend on any one person
still being around.
:::
