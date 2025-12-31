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

# CRITICAL: Set PATH for cron (Alpine cron has very limited PATH)
# Without this, cron won't find 'node'
CRON_PATH="/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin"

# Use the Alpine-compatible cron script
CRON_SCRIPT="/app/scripts/cron-collect-history-alpine.sh"

# Make sure the script is executable
if [ -f "$CRON_SCRIPT" ]; then
  chmod +x "$CRON_SCRIPT"
  {
    echo "PATH=$CRON_PATH"
    printf '%s %s >> /app/logs/cron-collect-$(date +%%%%Y-%%%%m-%%%%d).log 2>&1\n' "${SCHEDULE}" "${CRON_SCRIPT}"
  } > /tmp/crontab.txt
  echo "Using Alpine-compatible cron script: $CRON_SCRIPT"
else
  # Fallback to direct Node.js execution if Alpine script doesn't exist
  {
    echo "PATH=$CRON_PATH"
    printf '%s cd /app && /usr/local/bin/node src/cli/collectHistory.js >> /app/logs/cron-collect-$(date +%%%%Y-%%%%m-%%%%d).log 2>&1\n' "${SCHEDULE}"
  } > /tmp/crontab.txt
  echo "Using direct Node.js execution (Alpine script not found)"
fi

crontab /tmp/crontab.txt
rm /tmp/crontab.txt
echo "=== Cron job configured ==="
crontab -l

# Check if crond is already running
if ! pgrep crond >/dev/null 2>&1; then
  # Start cron daemon in background
  echo "=== Starting cron daemon ==="
  crond -l 2
else
  echo "=== Cron daemon already running ==="
fi

# Execute the main command
echo "=== Starting web server ==="
exec "$@"
