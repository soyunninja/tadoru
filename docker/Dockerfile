# Tadoru — single-service image. No database container: SQLite lives in the data volume.
# Debian slim rather than Alpine because better-sqlite3 ships glibc prebuilds.

# ---- build: bundle and minify the browser tracker ------------------------------
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tracker ./tracker
RUN npm run build:tracker          # -> /app/public/t.js

# ---- deps: runtime dependencies only -------------------------------------------
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev              # leaves typescript/esbuild out of the final image

# ---- runtime -------------------------------------------------------------------
FROM node:24-slim AS runtime

# tini reaps zombies and forwards signals, so `docker compose down` stops the
# in-process crons cleanly instead of killing one mid-transaction.
RUN apt-get update \
 && apt-get install --no-install-recommends -y tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Inside a container the service must listen on all interfaces or Docker's port
# mapping cannot reach it. Outside a container the default is loopback, which is
# the right default there. Exposure is controlled by how the port is published.
ENV NODE_ENV=production \
    TADORU_DATA_DIR=/data \
    TADORU_HOST=0.0.0.0 \
    TADORU_PORT=3000

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/public       ./public
COPY package.json tadoru.config.example.json ./
COPY src ./src
COPY bin ./bin

# The data volume holds the SQLite database, the session secret and backups.
# It is the only thing that needs backing up.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.TADORU_PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Node 24 runs the TypeScript sources directly via type stripping — no build step for the server.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "bin/tadoru.ts", "start"]
