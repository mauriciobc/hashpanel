#!/bin/sh
set -e

# Garante que os diretórios de dados e logs existam
mkdir -p /app/data /app/logs

# Prepara o banco de dados
echo "=== Initializing database ==="
python -m hashpanel.cli.collect --help >/dev/null 2>&1 || true
python -c "from hashpanel.database.connection import get_database; get_database().close()" \
  || echo "Database migration skipped or already done"

# Configura o cron
echo "=== Setting up cron job ==="
SCHEDULE="${CRON_SCHEDULE:-0 2 * * *}"

# O cron do Alpine tem um PATH mínimo, então definimos os caminhos explicitamente
CRON_PATH="/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin"
CRON_SCRIPT="/app/scripts/cron-collect-history.sh"

if [ -f "$CRON_SCRIPT" ]; then
  chmod +x "$CRON_SCRIPT"
  {
    echo "PATH=$CRON_PATH"
    printf '%s %s >> /app/logs/cron-collect-$(date +\\%%Y-\\%%m-\\%%d).log 2>&1\n' \
      "${SCHEDULE}" "${CRON_SCRIPT}"
  } > /tmp/crontab.txt
  echo "Using cron script: $CRON_SCRIPT"
else
  {
    echo "PATH=$CRON_PATH"
    printf '%s cd /app && hashpanel-collect >> /app/logs/cron-collect-$(date +\\%%Y-\\%%m-\\%%d).log 2>&1\n' \
      "${SCHEDULE}"
  } > /tmp/crontab.txt
  echo "Using direct collection command"
fi

crontab /tmp/crontab.txt
rm /tmp/crontab.txt
echo "=== Cron job configured ==="
crontab -l

# Inicia o cron em segundo plano. O nome do daemon varia entre
# distribuições (crond no Alpine/BSD, cron no Debian).
echo "=== Starting cron daemon ==="
if command -v crond >/dev/null 2>&1; then
  crond -l 2
elif command -v cron >/dev/null 2>&1; then
  cron
else
  echo "Warning: no cron daemon found, scheduled collection is disabled"
fi

# Executa o comando principal
echo "=== Starting web server ==="
exec "$@"
