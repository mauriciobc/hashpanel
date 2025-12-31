#!/bin/bash
#
# Script para coleta diária de histórico de hashtags
# Este script é chamado pelo cron job
#
# Variáveis de ambiente devem estar configuradas no .env
# ou no crontab

# Obter diretório do script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Mudar para o diretório do projeto
cd "$PROJECT_DIR" || exit 1

# Carregar variáveis de ambiente se .env existir
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# Caminho do Node.js (ajuste se necessário)
NODE_PATH=$(command -v node 2>/dev/null)
if [ -z "$NODE_PATH" ]; then
  echo "Erro: Node.js não encontrado no PATH"
  exit 1
fi

# Caminho do script de coleta
COLLECT_SCRIPT="$PROJECT_DIR/src/cli/collectHistory.js"

# Verificar se o script existe
if [ ! -f "$COLLECT_SCRIPT" ]; then
  echo "Erro: Script de coleta não encontrado: $COLLECT_SCRIPT"
  exit 1
fi

# Diretório de logs
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"

# Arquivo de log com data
LOG_FILE="$LOG_DIR/cron-collect-$(date +%Y-%m-%d).log"

# Verificar se está sendo executado via cron (sem TTY) ou manualmente
if [ -t 0 ]; then
  # Execução manual: mostrar output no console E no log
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Iniciando coleta diária de histórico" | tee -a "$LOG_FILE"
  "$NODE_PATH" "$COLLECT_SCRIPT" 2>&1 | tee -a "$LOG_FILE"
  EXIT_CODE=${PIPESTATUS[0]}
else
  # Execução via cron: apenas log
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Iniciando coleta diária de histórico" >> "$LOG_FILE"
  "$NODE_PATH" "$COLLECT_SCRIPT" >> "$LOG_FILE" 2>&1
  EXIT_CODE=$?
fi

if [ $EXIT_CODE -eq 0 ]; then
  if [ -t 0 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Coleta concluída com sucesso" | tee -a "$LOG_FILE"
  else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Coleta concluída com sucesso" >> "$LOG_FILE"
  fi
else
  if [ -t 0 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Erro na coleta (código: $EXIT_CODE)" | tee -a "$LOG_FILE"
  else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Erro na coleta (código: $EXIT_CODE)" >> "$LOG_FILE"
  fi
fi

exit $EXIT_CODE
