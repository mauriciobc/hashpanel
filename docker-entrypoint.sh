#!/bin/sh
set -e

# Diretórios base. Os valores podem ser sobrescritos por variáveis de
# ambiente (usado pelos testes), mas no container valem os padrões.
APP_DIR="${HASHPANEL_APP_DIR:-/app}"
DATA_DIR="${HASHPANEL_DATA_DIR:-$APP_DIR/data}"
LOG_DIR="${HASHPANEL_LOG_DIR:-$APP_DIR/logs}"

# Garante que os diretórios de dados e logs existam. A falha aqui não deve
# impedir a subida do servidor.
mkdir -p "$DATA_DIR" "$LOG_DIR" || echo "Warning: could not create data/log directories" >&2

# ---------------------------------------------------------------------------
# Ambiente do cron
#
# O daemon do cron não herda o ambiente do container: as variáveis chegam
# apenas ao processo do servidor web (env_file/environment do Compose) e o
# .env não entra na imagem (.dockerignore). Sem isso, o hashpanel-collect
# agendado rodaria sem MASTODON_URL e falharia toda noite.
#
# Solução: persistimos aqui, antes de instalar o crontab, um arquivo com os
# exports necessários (modo 600, legível pelo cron que roda como root). O
# scripts/cron-collect-history.sh carrega esse arquivo antes de coletar.
# Os valores nunca são ecoados em log nem escritos no crontab.
# ---------------------------------------------------------------------------
CRON_ENV_FILE="${HASHPANEL_CRON_ENV_FILE:-$DATA_DIR/.cron-env}"

# Variáveis de que a coleta agendada precisa. SERVER_PUBLIC_URL entra
# porque o relatório publicado pelo cron cita a URL pública do painel.
CRON_ENV_VARS="MASTODON_URL CLIENT_KEY CLIENT_SECRET ACCESS_TOKEN \
PREFERRED_TIMEZONE RATE_LIMIT_DELAY_MS MAX_API_PAGES TOOTS_PER_PAGE \
API_TIMEOUT_MS DB_PATH LOG_LEVEL SERVER_PUBLIC_URL"

# Escapa o valor para uso seguro entre aspas simples no arquivo de ambiente.
shell_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

write_cron_env() {
  _tmp="${CRON_ENV_FILE}.tmp.$$"

  # Tudo em um subshell: uma falha de redirecionamento (diretório sem
  # permissão, caminho inválido) encerra apenas o subshell, sem abortar o
  # entrypoint por causa do `set -e`.
  (
    umask 077
    : > "$_tmp" || exit 1
    for _name in $CRON_ENV_VARS; do
      # Indireção sem ${!name} (o /bin/sh do Debian é o dash).
      eval "_value=\${$_name-}"
      [ -n "$_value" ] || continue
      printf 'export %s=%s\n' "$_name" "$(shell_quote "$_value")" >> "$_tmp" || exit 1
    done
    chmod 600 "$_tmp" || exit 1
    mv -f "$_tmp" "$CRON_ENV_FILE" || exit 1
  ) || {
    rm -f "$_tmp" 2>/dev/null || true
    return 1
  }
  return 0
}

if write_cron_env; then
  echo "Cron environment written to $CRON_ENV_FILE"
else
  echo "Warning: could not write cron environment file $CRON_ENV_FILE" >&2
fi

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
CRON_SCRIPT="${HASHPANEL_CRON_SCRIPT:-$APP_DIR/scripts/cron-collect-history.sh}"
CRON_TAB="${HASHPANEL_CRON_TAB:-/tmp/crontab.txt}"

if [ -f "$CRON_SCRIPT" ]; then
  chmod +x "$CRON_SCRIPT" || echo "Warning: could not make $CRON_SCRIPT executable" >&2
  {
    echo "PATH=$CRON_PATH"
    printf '%s %s >> %s/cron-collect-$(date +\\%%Y-\\%%m-\\%%d).log 2>&1\n' \
      "${SCHEDULE}" "${CRON_SCRIPT}" "${LOG_DIR}"
  } > "$CRON_TAB"
  echo "Using cron script: $CRON_SCRIPT"
else
  {
    echo "PATH=$CRON_PATH"
    printf '%s cd %s && hashpanel-collect >> %s/cron-collect-$(date +\\%%Y-\\%%m-\\%%d).log 2>&1\n' \
      "${SCHEDULE}" "${APP_DIR}" "${LOG_DIR}"
  } > "$CRON_TAB"
  echo "Using direct collection command"
fi

crontab "$CRON_TAB"
rm -f "$CRON_TAB"
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
