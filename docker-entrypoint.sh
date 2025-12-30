#!/bin/sh
set -e

# Ensure data and logs directories exist
mkdir -p /app/data /app/logs

# Run database migrations
echo "=== Initializing database ==="
npm run db:migrate || echo "Database migration skipped or already done"

# Setup cron job
echo "=== Setting up cron job ==="
SCHEDULE="${CRON_SCHEDULE:-0 2 * * *}"
printf '%s cd /app && /usr/local/bin/node src/cli/collectHistory.js >> /app/logs/cron-collect-$(date +%%Y-%%m-%%d).log 2>&1\n' "${SCHEDULE}" > /tmp/crontab.txt
crontab /tmp/crontab.txt
rm /tmp/crontab.txt
echo "=== Cron job configured ==="
crontab -l

# Start cron daemon in background
echo "=== Starting cron daemon ==="
crond -l 2

# Execute the main command
echo "=== Starting web server ==="
exec "$@"
