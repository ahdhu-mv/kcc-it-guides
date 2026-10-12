# --- build the Next.js app
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# --- runtime: Node (the app) + git/ssh (publishing) + Python (the exact site renderer, for previews)
FROM node:24-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends git openssh-client ca-certificates gosu python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir markdown==3.10.2 pyyaml==6.0.3 jinja2==3.1.6 pygments==2.20.0 nh3==0.3.7 \
    && useradd --system --create-home --uid 10001 guides

ENV PYTHONDONTWRITEBYTECODE=1 NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8000 HOSTNAME=0.0.0.0 \
    DATA_DIR=/data PYTHON_BIN=/opt/venv/bin/python PREVIEW_SCRIPT=/app/preview/preview.py
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY preview ./preview
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]
