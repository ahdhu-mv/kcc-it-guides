---
title: Deploying a Laravel App — Guide for Naaif
description: Setup your laravel apps like this
updated: 2026-09-18
---

This covers deploying a Laravel web application on this server, using `docker-compose`. This fits into the existing infrastructure (Docker, `app-network`, `nginx-gateway`) without needing any changes from the infra side.
**Scope:** this is entirely your side of the handover — app containers, nginx routing, and TLS. See `HANDOVER.md` for the full division of responsibility.

::: callout Before you start
Ansible playbook can be made for you if you like to keep configurations in a file and oraganized.
This is just a way to do everything manually
:::
 
## 1. Overview of what you're building
 
Three containers, all joined to the existing `app-network`:
 
- **laravel-app** — PHP-FPM + the Laravel codebase
- **laravel-db** — MySQL (or PostgreSQL), persistent data
- **laravel-nginx** — a small nginx container that serves PHP through FPM (separate from the shared `nginx-gateway`, which just proxies to this one)
`nginx-gateway` (already running, infra-managed) will proxy the public domain to `laravel-nginx` inside the network. None of these three containers need published ports — only `nginx-gateway` is exposed to the network/internet.
 
---
 
## 2. Directory layout on the server
 
```bash
sudo mkdir -p /opt/app-data/laravel/app
sudo mkdir -p /opt/app-data/laravel/db
sudo mkdir -p /opt/app-data/laravel/nginx
cd /opt/app-data/laravel
```
 
Put your Laravel codebase into `/opt/app-data/laravel/app` (via `git clone`, `scp`, or however you're getting the code onto the server).
 
Using `/opt/app-data/` for everything means it's automatically covered by the existing nightly backup job — no extra backup config needed.
 
---
 
## 3. `docker-compose.yml`
 
Create this at `/opt/app-data/laravel/docker-compose.yml`:
 
```yaml
services:
  laravel-app:
    image: serversideup/php:8.3-fpm
    container_name: laravel-app
    restart: unless-stopped
    working_dir: /var/www/html
    volumes:
      - ./app:/var/www/html
    environment:
      - APP_ENV=production
      - DB_HOST=laravel-db
      - DB_DATABASE=laravel
      - DB_USERNAME=laravel
      - DB_PASSWORD=${DB_PASSWORD}
    networks:
      - app-network
    depends_on:
      - laravel-db
 
  laravel-nginx:
    image: nginx:1.27-alpine
    container_name: laravel-nginx
    restart: unless-stopped
    volumes:
      - ./app:/var/www/html:ro
      - ./nginx/laravel.conf:/etc/nginx/conf.d/default.conf:ro
    networks:
      - app-network
    depends_on:
      - laravel-app
 
  laravel-db:
    image: mysql:8
    container_name: laravel-db
    restart: unless-stopped
    environment:
      - MYSQL_ROOT_PASSWORD=${DB_ROOT_PASSWORD}
      - MYSQL_DATABASE=laravel
      - MYSQL_USER=laravel
      - MYSQL_PASSWORD=${DB_PASSWORD}
    volumes:
      - ./db:/var/lib/mysql
    networks:
      - app-network
 
networks:
  app-network:
    external: true
```
 
`networks.app-network.external: true` is important — it tells Compose to join the **existing** network created by the infra playbook, rather than creating a new isolated one. Without this, `laravel-nginx` won't be reachable from `nginx-gateway`.
 
---
 
## 4. Environment variables — secrets
 
Create `/opt/app-data/laravel/.env.docker` (used by Compose, separate from Laravel's own `.env`):
 
```bash
DB_PASSWORD=<choose-a-strong-password>
DB_ROOT_PASSWORD=<choose-a-different-strong-password>
```
 
Reference it when running Compose:
```bash
docker compose --env-file .env.docker up -d
```
 
Keep this file out of git if the codebase is version-controlled — add it to `.gitignore`.
 
---
 
## 5. nginx config for PHP-FPM
 
Create `/opt/app-data/laravel/nginx/laravel.conf`:
 
```nginx
server {
    listen 80;
    index index.php index.html;
    root /var/www/html/public;
 
    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }
 
    location ~ \.php$ {
        fastcgi_pass laravel-app:9000;
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
    }
 
    location ~ /\.ht {
        deny all;
    }
}
```
 
---
 
## 6. Bring it up
 
```bash
cd /opt/app-data/laravel
docker compose --env-file .env.docker up -d
```
 
Check it started cleanly:
```bash
docker compose ps
docker compose logs -f
```
 
---
 
## 7. Laravel setup steps (first run)
 
```bash
docker exec -it laravel-app php artisan key:generate
docker exec -it laravel-app php artisan migrate
docker exec -it laravel-app php artisan config:cache
```
 
Make sure Laravel's own `.env` file (inside `/opt/app-data/laravel/app/.env`) has:
```
DB_CONNECTION=mysql
DB_HOST=laravel-db
DB_PORT=3306
DB_DATABASE=laravel
DB_USERNAME=laravel
DB_PASSWORD=<same as DB_PASSWORD above>
```
 
---
 
## 8. Wire it into the shared reverse proxy
 
Edit the shared gateway config:
```bash
sudo nano /opt/nginx-proxy/default.conf
```
 
Add a server block:
```nginx
server {
    listen 80;
    server_name laravel.kcc.mv;   # replace with the real domain
 
    location / {
        proxy_pass http://laravel-nginx:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```
 
Apply it:
```bash
docker restart nginx-gateway
```
 
---
 
## 9. TLS certificate (only if using a real public domain, not `.local`)
 
DNS for the domain must already point at this server, and port 80 must be reachable from the internet, before running this:
 
```bash
sudo docker run --rm \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v /var/www/certbot:/var/www/certbot \
  certbot/certbot:v2.11.0 \
  certonly --webroot -w /var/www/certbot -d laravel.kcc.mv \
  --email your-email@kcc.mv --agree-tos --no-eff-email
```
 
Once issued, update the server block in `/opt/nginx-proxy/default.conf` to listen on 443 with the certificate paths (see the existing `.kcc.mv` entries in that file, if any, for the expected format), then:
```bash
docker restart nginx-gateway
```
 
---
 
## 10. Day-to-day operations
 
```bash
# View logs
docker compose -f /opt/app-data/laravel/docker-compose.yml logs -f laravel-app
 
# Restart everything
cd /opt/app-data/laravel && docker compose restart
 
# Run an artisan command
docker exec -it laravel-app php artisan <command>
 
# Pull latest code and redeploy (if using git)
cd /opt/app-data/laravel/app
git pull
docker exec -it laravel-app php artisan migrate --force
docker exec -it laravel-app php artisan config:cache
docker compose restart laravel-app
```
 
---
 
## Notes
 
- Everything under `/opt/app-data/laravel` (including the MySQL data directory) is covered by the existing nightly backup job — no extra backup setup needed.
- Do not open any ports for these containers in UFW — they're reached only through `nginx-gateway`, which is already allowed through the firewall on 80/443.
- If you need help with the initial setup, or run into issues with the nginx routing or certificate step, reach out to Ahdhu (KCC IT) — the underlying server/network layer is still supported even though the app layer is yours to manage.