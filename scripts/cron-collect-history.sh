#!/bin/bash
#
# Coleta diária do histórico de hashtags.
# Executado pelo cron; também pode ser rodado manualmente.
#
# As variáveis de ambiente vêm do .env ou do ambiente do container.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR" || exit 1

# Carrega as variáveis de ambiente se o .env existir.
# O arquivo pode ter quebras CRLF, então removemos o \r dos valores.
if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|'#'*) continue ;;
    esac
    key="${line%%=*}"
    value="${line#*=}"
    value="${value%$'\r'}"
    value="${value%$'\n'}"
    export "$key=$value"
  done < .env
fi

LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/cron-collect-$(date +%Y-%m-%d).log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

run() {
  if [ -t 0 ]; then
    log "$1" | tee -a "$LOG_FILE"
    shift
    "$@" 2>&1 | tee -a "$LOG_FILE"
    return ${PIPESTATUS[0]}
  fi
  log "$1" >> "$LOG_FILE"
  shift
  "$@" >> "$LOG_FILE" 2>&1
}

COLLECT_CMD="hashpanel-collect"
REPORT_CMD="hashpanel"

if ! command -v "$COLLECT_CMD" >/dev/null 2>&1; then
  COLLECT_CMD="python -m hashpanel.cli.collect"
  REPORT_CMD="python -m hashpanel.cli.main"
fi

# 1. Coleta o histórico
run "Iniciando coleta diária de histórico" $COLLECT_CMD
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  run "Coleta concluída com sucesso" true

  # 2. Publica o relatório do dia com o tema claro
  run "Gerando relatório diário com tema claro" $REPORT_CMD report --light
  REPORT_EXIT_CODE=$?

  if [ $REPORT_EXIT_CODE -eq 0 ]; then
    run "Relatório publicado com sucesso" true
  else
    # A falha do relatório não deve reprovar o job.
    run "Erro ao publicar relatório (código: $REPORT_EXIT_CODE)" true
  fi
else
  run "Erro na coleta (código: $EXIT_CODE)" true
fi

exit $EXIT_CODE
