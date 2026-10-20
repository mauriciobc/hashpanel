#!/bin/sh
#
# Coleta diária do histórico de hashtags (compatível com Alpine/Docker).
# Executado pelo cron job dentro do container.
#
# As variáveis de ambiente vêm do .env ou do ambiente do container.

set -e

SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
PROJECT_DIR=$(dirname "$SCRIPT_DIR")

cd "$PROJECT_DIR" || exit 1

# Carrega as variáveis do .env, tolerando CRLF e aspas.
if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "#"* | "") continue ;;
    esac

    line="${line#export }"

    case "$line" in
      *"="*)
        key="${line%%=*}"
        value="${line#*=}"

        key=$(printf '%s' "$key" | tr -d '[:space:]')
        value="${value%$'\r'}"

        case "$value" in
          \"*)
            value=$(printf '%s' "$value" | sed 's/^"\([^"]*\)".*/\1/')
            ;;
          \'*)
            value=$(printf '%s' "$value" | sed "s/^'\([^']*\)'.*/\1/")
            ;;
          *)
            value="${value%%#*}"
            value=$(printf '%s' "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
            ;;
        esac

        export "$key"="$value"
        ;;
    esac
  done < .env
fi

LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/cron-collect-$(date +%Y-%m-%d).log"

COLLECT_CMD="hashpanel-collect"
REPORT_CMD="hashpanel"

if ! command -v "$COLLECT_CMD" >/dev/null 2>&1; then
  COLLECT_CMD="python -m hashpanel.cli.collect"
  REPORT_CMD="python -m hashpanel.cli.main"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Iniciando coleta diária de histórico" >> "$LOG_FILE"

# shellcheck disable=SC2086
$COLLECT_CMD >> "$LOG_FILE" 2>&1
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Coleta concluída com sucesso" >> "$LOG_FILE"

  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Gerando relatório diário com tema claro" >> "$LOG_FILE"
  # shellcheck disable=SC2086
  $REPORT_CMD report --light >> "$LOG_FILE" 2>&1
  REPORT_EXIT_CODE=$?

  if [ $REPORT_EXIT_CODE -eq 0 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Relatório publicado com sucesso" >> "$LOG_FILE"
  else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Erro ao publicar relatório (código: $REPORT_EXIT_CODE)" >> "$LOG_FILE"
    # Não falhar o job se o relatório falhar
  fi
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Erro na coleta (código: $EXIT_CODE)" >> "$LOG_FILE"
fi

exit $EXIT_CODE
