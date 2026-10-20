#!/bin/sh
#
# Script para configurar cron job de coleta diária (Alpine Linux compatible)
# Este script adiciona/atualiza o cron job no crontab
#
# Compatível com ash (Alpine Linux / BusyBox)

set -e

# Cores para output (usando printf ao invés de echo -e)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

printf "${CYAN}═══════════════════════════════════════════════════════════${NC}\n"
printf "${CYAN}  CONFIGURAÇÃO DE CRON JOB PARA COLETA DIÁRIA${NC}\n"
printf "${CYAN}═══════════════════════════════════════════════════════════${NC}\n"
printf "\n"
printf "${BLUE}ℹ️  Este job executará:${NC}\n"
printf "   1. Coleta de histórico de hashtags\n"
printf "   2. Publicação de relatório diário (tema claro)\n"
printf "\n"

# Obter diretório do script de forma robusta
SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
CRON_SCRIPT="$SCRIPT_DIR/cron-collect-history-alpine.sh"

# Verificar se o script existe
if [ ! -f "$CRON_SCRIPT" ]; then
  printf "${RED}❌ Erro: Script de cron não encontrado: $CRON_SCRIPT${NC}\n"
  exit 1
fi

# Tornar script executável
chmod +x "$CRON_SCRIPT"
printf "${GREEN}✅ Script de cron tornado executável${NC}\n"

# Obter hora para execução (padrão: 02:00)
printf "Hora para execução diária (formato HH:MM, padrão 02:00): "
read CRON_TIME
CRON_TIME=${CRON_TIME:-02:00}

# Validar formato usando case ao invés de regex bash
validate_time() {
  case "$1" in
    [0-1][0-9]:[0-5][0-9]|2[0-3]:[0-5][0-9])
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

if ! validate_time "$CRON_TIME"; then
  printf "${RED}❌ Formato de hora inválido. Use HH:MM (ex: 02:00)${NC}\n"
  exit 1
fi

# Extrair hora e minuto (usando cut, compatível com ash)
HOUR=$(echo "$CRON_TIME" | cut -d: -f1)
MINUTE=$(echo "$CRON_TIME" | cut -d: -f2)

# Criar entrada do cron
CRON_ENTRY="$MINUTE $HOUR * * * /bin/sh -c 'exec \"$CRON_SCRIPT\"'"

printf "\n"
printf "${BLUE}📋 Configuração do cron job:${NC}\n"
printf "   Horário: ${CYAN}$CRON_TIME${NC} (diariamente)\n"
printf "   Script: ${CYAN}\"$CRON_SCRIPT\"${NC}\n"
printf "\n"

# Verificar se crontab está disponível
if ! command -v crontab >/dev/null 2>&1; then
  printf "${RED}❌ Erro: crontab não encontrado. Este sistema pode estar em Docker.${NC}\n"
  printf "${YELLOW}Para Docker, use o docker-entrypoint.sh ou configure CRON_SCHEDULE.${NC}\n"
  exit 1
fi

# Verificar se já existe entrada no crontab
CRON_EXISTS=$(crontab -l 2>/dev/null | grep -F "$CRON_SCRIPT" || true)

if [ -n "$CRON_EXISTS" ]; then
  printf "${YELLOW}⚠️  Já existe um cron job para este script${NC}\n"
  printf "\n"
  printf "Entrada existente:\n"
  printf "${CYAN}$CRON_EXISTS${NC}\n"
  printf "\n"
  printf "Deseja substituir? (s/N): "
  read REPLACE
  
  # Verificar resposta (case insensitive usando case)
  case "$REPLACE" in
    [Ss]|[Ss][Ii][Mm])
      # Remover entrada existente
      crontab -l 2>/dev/null | grep -vF "$CRON_SCRIPT" | crontab -
      printf "${GREEN}✅ Entrada antiga removida${NC}\n"
      ;;
    *)
      printf "${YELLOW}Operação cancelada${NC}\n"
      exit 0
      ;;
  esac
fi

# CRÍTICO: Adicionar PATH ao crontab
# O cron no Alpine tem PATH muito restrito e pode não encontrar o Python
# nem os executáveis instalados em /usr/local/bin
printf "\n"
printf "${BLUE}🔧 Configurando PATH no crontab...${NC}\n"

CURRENT_PATH=$PATH
TEMP_CRON="/tmp/crontab_temp_$$"

# Extrair PATH existente do crontab (se houver)
EXISTING_CRON_PATH=$(crontab -l 2>/dev/null | grep "^PATH=" | head -n1 | cut -d= -f2- || echo "")

# Merge inteligente de PATHs (sem duplicatas, compatível com ash/POSIX)
if [ -n "$EXISTING_CRON_PATH" ]; then
  printf "${YELLOW}⚠️  PATH existente encontrado no crontab - será preservado e mesclado${NC}\n"
  # Combinar paths e remover duplicatas mantendo a ordem
  FINAL_PATH=$(printf '%s\n' "$CURRENT_PATH" "$EXISTING_CRON_PATH" | tr ':' '\n' | awk '!seen[$0]++' | paste -sd ':' -)
else
  FINAL_PATH="$CURRENT_PATH"
fi

# Criar novo crontab: remover script antigo, remover PATH antigo, adicionar PATH mesclado, adicionar novo job
{
  crontab -l 2>/dev/null | grep -vF "$CRON_SCRIPT" | grep -v "^PATH=" || true
  echo "PATH=$FINAL_PATH"
  echo "$CRON_ENTRY"
} > "$TEMP_CRON"

crontab "$TEMP_CRON"
rm -f "$TEMP_CRON"

printf "${GREEN}✅ Cron job adicionado com sucesso!${NC}\n"
printf "${GREEN}✅ PATH configurado: ${CYAN}$FINAL_PATH${NC}\n"

# Tentar iniciar o crond se não estiver rodando
if ! pgrep crond >/dev/null 2>&1; then
  printf "\n"
  printf "${YELLOW}⚠️  Daemon crond não está rodando${NC}\n"
  printf "${BLUE}Tentando iniciar crond...${NC}\n"
  
  if crond -b 2>/dev/null; then
    printf "${GREEN}✅ Daemon crond iniciado com sucesso${NC}\n"
  else
    printf "${YELLOW}⚠️  Não foi possível iniciar crond automaticamente${NC}\n"
    printf "${YELLOW}   Execute manualmente: ${CYAN}crond -b${NC}\n"
  fi
else
  printf "\n"
  printf "${GREEN}✅ Daemon crond já está rodando${NC}\n"
fi

printf "\n"
printf "${CYAN}═══════════════════════════════════════════════════════════${NC}\n"
printf "${GREEN}✅ CONFIGURAÇÃO CONCLUÍDA${NC}\n"
printf "${CYAN}═══════════════════════════════════════════════════════════${NC}\n"
printf "\n"
printf "${BLUE}📋 Comandos úteis:${NC}\n"
printf "\n"
printf "  Ver cron jobs:\n"
printf "    ${CYAN}crontab -l${NC}\n"
printf "\n"
printf "  Editar cron jobs:\n"
printf "    ${CYAN}crontab -e${NC}\n"
printf "\n"
printf "  Remover todos os cron jobs:\n"
printf "    ${CYAN}crontab -r${NC}\n"
printf "\n"
printf "  Ver logs da coleta:\n"
printf "    ${CYAN}tail -f logs/cron-collect-\$(date +%%Y-%%m-%%d).log${NC}\n"
printf "\n"
printf "  Testar o script manualmente:\n"
printf "    ${CYAN}\"$CRON_SCRIPT\"${NC}\n"
printf "\n"
