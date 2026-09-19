FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends nginx \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-available/default

WORKDIR /site

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

COPY . .
# Build once at image-creation time so the site works even if content/
# is never bind-mounted (e.g. a plain `docker run` with no volumes).
RUN python3 build.py

EXPOSE 80
CMD ["/entrypoint.sh"]
