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

# Install RUNTIME-ONLY dependencies (much lighter)
RUN apk add --no-cache \
    curl dcron cairo pango pixman libjpeg-turbo giflib \
    fontconfig ttf-dejavu

WORKDIR /app

# Copy ONLY what is necessary from builder
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY . .

# Copy and set permissions for entrypoint script
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Environment Defaults
ENV NODE_ENV=production \
    PORT=3000

# Create necessary directories
RUN mkdir -p logs data

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=15s --start-period=60s --retries=5 \
  CMD curl -f http://localhost:3000/health || exit 1

# Use the ENTRYPOINT to handle the cron/start logic
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["npm", "run", "server"]
