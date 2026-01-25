#!/bin/bash
#
# Script para configurar cron job de coleta diária
# Este script adiciona/atualiza o cron job no crontab do usuário
#

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  CONFIGURAÇÃO DE CRON JOB PARA COLETA DIÁRIA${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}ℹ️  Este job executará:${NC}"
echo -e "   1. Coleta de histórico de hashtags"
echo -e "   2. Publicação de relatório diário (tema claro)"
echo ""

# Obter diretório do script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CRON_SCRIPT="$SCRIPT_DIR/cron-collect-history.sh"

# Verificar se o script existe
if [ ! -f "$CRON_SCRIPT" ]; then
  echo -e "${RED}❌ Erro: Script de cron não encontrado: $CRON_SCRIPT${NC}"
  exit 1
fi

# Tornar script executável
chmod +x "$CRON_SCRIPT"
echo -e "${GREEN}✅ Script de cron tornado executável${NC}"

# Obter hora para execução (padrão: 02:00)
read -p "Hora para execução diária (formato HH:MM, padrão 02:00): " CRON_TIME
CRON_TIME=${CRON_TIME:-02:00}

# Validar formato
if ! [[ "$CRON_TIME" =~ ^([0-1][0-9]|2[0-3]):[0-5][0-9]$ ]]; then
  echo -e "${RED}❌ Formato de hora inválido. Use HH:MM (ex: 02:00)${NC}"
  exit 1
fi

# Extrair hora e minuto
HOUR=$(echo "$CRON_TIME" | cut -d: -f1)
MINUTE=$(echo "$CRON_TIME" | cut -d: -f2)

# Criar entrada do cron
CRON_ENTRY="$MINUTE $HOUR * * * /bin/sh -c 'exec \"$CRON_SCRIPT\"'"

echo ""
echo -e "${BLUE}📋 Configuração do cron job:${NC}"
echo -e "   Horário: ${CYAN}$CRON_TIME${NC} (diariamente)"
echo -e "   Script: ${CYAN}\"$CRON_SCRIPT\"${NC}"
echo ""

# Verificar se já existe entrada no crontab
CRON_EXISTS=$(crontab -l 2>/dev/null | grep -F "$CRON_SCRIPT" || true)

if [ -n "$CRON_EXISTS" ]; then
  echo -e "${YELLOW}⚠️  Já existe um cron job para este script${NC}"
  echo ""
  echo "Entrada existente:"
  echo -e "${CYAN}$CRON_EXISTS${NC}"
  echo ""
  read -p "Deseja substituir? (s/N): " REPLACE
  
  if [[ ! "$REPLACE" =~ ^[Ss]$ ]]; then
    echo -e "${YELLOW}Operação cancelada${NC}"
    exit 0
  fi
  
  # Remover entrada existente
  crontab -l 2>/dev/null | grep -vF "$CRON_SCRIPT" | crontab -
  echo -e "${GREEN}✅ Entrada antiga removida${NC}"
fi

# Adicionar nova entrada
(crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -
echo -e "${GREEN}✅ Cron job adicionado com sucesso!${NC}"

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ CONFIGURAÇÃO CONCLUÍDA${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}📋 Comandos úteis:${NC}"
echo ""
echo -e "  Ver cron jobs:"
echo -e "    ${CYAN}crontab -l${NC}"
echo ""
echo -e "  Editar cron jobs:"
echo -e "    ${CYAN}crontab -e${NC}"
echo ""
echo -e "  Remover todos os cron jobs:"
echo -e "    ${CYAN}crontab -r${NC}"
echo ""
echo -e "  Ver logs da coleta:"
echo -e "    ${CYAN}tail -f logs/cron-collect-\$(date +%Y-%m-%d).log${NC}"
echo ""
echo -e "  Testar o script manualmente:"
echo -e "    ${CYAN}\"$CRON_SCRIPT\"${NC}"
echo ""
