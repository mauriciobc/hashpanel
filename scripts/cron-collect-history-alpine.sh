#!/bin/sh
#
# Script para coleta diária de histórico de hashtags (Alpine Linux compatible)
# Este script é chamado pelo cron job em containers Alpine/Docker
#
# Variáveis de ambiente devem estar configuradas no .env
# ou no crontab

set -e

# Obter diretório do script de forma robusta (readlink -f é mais confiável)
SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
PROJECT_DIR=$(dirname "$SCRIPT_DIR")

# Mudar para o diretório do projeto
cd "$PROJECT_DIR" || exit 1

# Carregar variáveis de ambiente se .env existir
# Método seguro que preserva valores com espaços
if [ -f .env ]; then
  while read -r line || [ -n "$line" ]; do
    case "$line" in
      "#"*) continue ;;  # Pula comentários
      "")   continue ;;  # Pula linhas vazias
      *)    export "$line" ;;
    esac
  done < .env
fi

# Caminho do Node.js (ajuste se necessário)
NODE_PATH=$(which node)
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

# Log de início
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
echo "[$TIMESTAMP] Iniciando coleta diária de histórico" >> "$LOG_FILE"

# Execução (Redirecionando stdout e stderr para o log)
# Nota: Simplificado para evitar complexidade com tee e PIPESTATUS
"$NODE_PATH" "$COLLECT_SCRIPT" >> "$LOG_FILE" 2>&1
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Coleta concluída com sucesso" >> "$LOG_FILE"
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Erro na coleta (código: $EXIT_CODE)" >> "$LOG_FILE"
fi

exit $EXIT_CODE
