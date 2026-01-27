# ============================================
# Stage 1: Builder
# ============================================
FROM node:22-alpine AS builder

# Install build dependencies
RUN apk add --no-cache \
    python3 make g++ build-base pkgconf \
    cairo-dev pango-dev libjpeg-turbo-dev giflib-dev pixman-dev

WORKDIR /app
COPY package*.json ./

# Install and build native modules
# --build-from-source ensures better-sqlite3 matches the architecture
RUN npm install --omit=dev --no-audit --no-fund
RUN npm rebuild better-sqlite3 --build-from-source

# ============================================
# Stage 2: Runtime
# ============================================
FROM node:22-alpine

RUN apk add --no-cache \
    curl dcron cairo pango pixman libjpeg-turbo giflib \
    fontconfig ttf-dejavu

WORKDIR /app

# 1. Copy the source code first
COPY . .

# 2. Overwrite the node_modules with the compiled ones from the builder
# This ensures that even if node_modules existed locally, they are replaced
COPY --from=builder /app/node_modules ./node_modules

# 3. Explicitly set up the entrypoint
# (Even if it was copied in step 1, we ensure permissions here)
RUN chmod +x /app/docker-entrypoint.sh && mkdir -p logs data

ENV NODE_ENV=production PORT=3000

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=15s --start-period=60s --retries=5 \
  CMD curl -f http://localhost:3000/health || exit 1

# Use the ENTRYPOINT to handle the cron/start logic
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["npm", "run", "server"]
