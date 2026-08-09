# ---------- Build stage ----------
FROM node:22-alpine AS builder
WORKDIR /app

# Install deps first (cache layer)
COPY package.json package-lock.json ./
RUN npm ci

# Build
COPY . .
RUN npm run build

# ---------- Runtime stage ----------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Persist SQLite + tokens here. Dokploy should mount a volume on /data
# so the db survives container restarts.
ENV PETRICCO_DATA_DIR=/data

# Non-root user
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Install gosu (tiny step-down from root to nextjs — su-exec alternative).
# Multi-arch: pull the right binary based on TARGETARCH.
ARG TARGETARCH
RUN if [ "$TARGETARCH" = "amd64" ]; then \
      wget -qO /usr/local/bin/gosu "https://github.com/tianon/gosu/releases/download/1.16/gosu-amd64"; \
    elif [ "$TARGETARCH" = "arm64" ]; then \
      wget -qO /usr/local/bin/gosu "https://github.com/tianon/gosu/releases/download/1.16/gosu-arm64"; \
    fi && chmod +x /usr/local/bin/gosu

# Persistent data dir owned by nextjs.
RUN mkdir -p /data && chown nextjs:nodejs /data

# Copy standalone build + public + static
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Switch back to root so the entrypoint can chown the mounted volume, then
# drop to nextjs for the actual node process.
USER root
EXPOSE 3000

ENTRYPOINT ["sh", "-c", "chown -R nextjs:nodejs /data 2>/dev/null || true; exec gosu nextjs node --experimental-sqlite server.js"]