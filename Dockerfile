# Use Node.js LTS version
FROM node:20-alpine

# Install build dependencies and cron
# These are needed for:
# - better-sqlite3 (native module compilation): python3, make, g++, build-base
# - cron daemon: dcron
# - utilities: curl, git (for health checks and debugging)
RUN apk add --no-cache \
    curl \
    git \
    python3 \
    python3-dev \
    py3-pip \
    make \
    g++ \
    build-base \
    dcron \
    && ln -sf /usr/bin/python3 /usr/bin/python

# Set working directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install npm dependencies (production only, omit dev dependencies)
# This will compile better-sqlite3 during build time
RUN npm install --omit=dev --no-audit --no-fund

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p logs data

# Copy and set permissions for entrypoint script
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=15s --start-period=60s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider --timeout=5 http://localhost:3000/health 2>/dev/null || \
      curl -f http://localhost:3000/health || exit 1

# Use entrypoint script and default to starting the server
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["npm", "run", "server"]
