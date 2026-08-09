# ---------- Build stage ----------
FROM node:20-alpine AS builder
WORKDIR /app

# better-sqlite3 needs a C++ toolchain to compile its native binding.
# Keep this in the build stage so the runtime image stays small.
RUN apk add --no-cache python3 make g++

# Install deps first (cache layer)
COPY package.json package-lock.json ./
RUN npm ci

# Build
COPY . .
RUN npm run build

# ---------- Runtime stage ----------
FROM node:20-alpine AS runner
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

# Persistent data dir owned by nextjs.
RUN mkdir -p /data && chown nextjs:nodejs /data

# Copy standalone build + public + static
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]