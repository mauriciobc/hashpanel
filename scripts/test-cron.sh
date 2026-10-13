#!/bin/sh
#
# Script de teste para validar configuração de cron no Alpine
# Execute dentro do container Docker: docker compose exec hashpanel ./test-alpine-cron.sh
#

set -e

printf "\n╔═══════════════════════════════════════════════════════════╗\n"
printf "║  🧪 TESTE DE CONFIGURAÇÃO CRON ALPINE                    ║\n"
printf "╚═══════════════════════════════════════════════════════════╝\n\n"

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 1. Verificar se está no Alpine
printf "${BLUE}1. Verificando sistema operacional...${NC}\n"
if [ -f /etc/alpine-release ]; then
  ALPINE_VERSION=$(cat /etc/alpine-release)
  printf "   ${GREEN}✅ Alpine Linux ${ALPINE_VERSION}${NC}\n"
else
  printf "   ${YELLOW}⚠️  Não é Alpine Linux${NC}\n"
fi

# 2. Verificar shell
printf "\n${BLUE}2. Verificando shell...${NC}\n"
CURRENT_SHELL=$(readlink /bin/sh)
printf "   /bin/sh -> ${CURRENT_SHELL}\n"
if echo "$CURRENT_SHELL" | grep -q "busybox"; then
  printf "   ${GREEN}✅ BusyBox ash (correto para Alpine)${NC}\n"
else
  printf "   ${YELLOW}⚠️  Shell diferente do esperado${NC}\n"
fi

# 3. Verificar Node.js
printf "\n${BLUE}3. Verificando Node.js...${NC}\n"
if command -v node >/dev/null 2>&1; then
  NODE_VERSION=$(node --version)
  NODE_PATH=$(command -v node 2>/dev/null)
  printf "   ${GREEN}✅ Node.js ${NODE_VERSION}${NC}\n"
  printf "   Localização: ${NODE_PATH}\n"
else
  printf "   ${RED}❌ Node.js não encontrado${NC}\n"
  exit 1
fi

# 4. Verificar crond
printf "\n${BLUE}4. Verificando daemon cron...${NC}\n"
if pgrep crond >/dev/null 2>&1; then
  CROND_PID=$(pgrep crond)
  printf "   ${GREEN}✅ crond rodando (PID: ${CROND_PID})${NC}\n"
else
  printf "   ${RED}❌ crond não está rodando${NC}\n"
  printf "   Execute: ${YELLOW}crond -b${NC}\n"
fi

# 5. Verificar crontab
printf "\n${BLUE}5. Verificando crontab configurado...${NC}\n"
if crontab -l >/dev/null 2>&1; then
  printf "   ${GREEN}✅ Crontab configurado:${NC}\n"
  crontab -l | while read line; do
    printf "   ${YELLOW}→${NC} %s\n" "$line"
  done
  
  # Verificar se PATH está configurado
  if crontab -l | grep -q "^PATH="; then
    printf "   ${GREEN}✅ PATH configurado no crontab${NC}\n"
  else
    printf "   ${RED}❌ PATH não configurado - cron pode não encontrar node!${NC}\n"
  fi
else
  printf "   ${YELLOW}⚠️  Nenhum crontab configurado${NC}\n"
fi

# 6. Verificar scripts Alpine
printf "\n${BLUE}6. Verificando scripts Alpine...${NC}\n"
COLLECT_SCRIPT="/app/scripts/cron-collect-history.sh"
SETUP_SCRIPT="/app/scripts/setup-cron.sh"

if [ -f "$COLLECT_SCRIPT" ]; then
  if [ -x "$COLLECT_SCRIPT" ]; then
    printf "   ${GREEN}✅ $COLLECT_SCRIPT (executável)${NC}\n"
  else
    printf "   ${YELLOW}⚠️  $COLLECT_SCRIPT (não executável)${NC}\n"
  fi
else
  printf "   ${RED}❌ $COLLECT_SCRIPT não encontrado${NC}\n"
fi

if [ -f "$SETUP_SCRIPT" ]; then
  if [ -x "$SETUP_SCRIPT" ]; then
    printf "   ${GREEN}✅ $SETUP_SCRIPT (executável)${NC}\n"
  else
    printf "   ${YELLOW}⚠️  $SETUP_SCRIPT (não executável)${NC}\n"
  fi
else
  printf "   ${RED}❌ $SETUP_SCRIPT não encontrado${NC}\n"
fi

# 7. Verificar sintaxe dos scripts
printf "\n${BLUE}7. Validando sintaxe dos scripts...${NC}\n"
if [ -f "$COLLECT_SCRIPT" ]; then
  if sh -n "$COLLECT_SCRIPT" 2>/dev/null; then
    printf "   ${GREEN}✅ cron-collect-history.sh: sintaxe OK${NC}\n"
  else
    printf "   ${RED}❌ cron-collect-history.sh: erro de sintaxe${NC}\n"
  fi
fi

if [ -f "$SETUP_SCRIPT" ]; then
  if sh -n "$SETUP_SCRIPT" 2>/dev/null; then
    printf "   ${GREEN}✅ setup-cron.sh: sintaxe OK${NC}\n"
  else
    printf "   ${RED}❌ setup-cron.sh: erro de sintaxe${NC}\n"
  fi
fi

# 8. Verificar diretório de logs
printf "\n${BLUE}8. Verificando diretório de logs...${NC}\n"
LOG_DIR="/app/logs"
if [ -d "$LOG_DIR" ]; then
  printf "   ${GREEN}✅ Diretório de logs existe${NC}\n"
  LOG_COUNT=$(ls -1 "$LOG_DIR"/cron-collect-*.log 2>/dev/null | wc -l)
  if [ "$LOG_COUNT" -gt 0 ]; then
    printf "   ${GREEN}✅ Encontrados $LOG_COUNT arquivo(s) de log${NC}\n"
    printf "   Último log: "
    ls -1t "$LOG_DIR"/cron-collect-*.log 2>/dev/null | head -1
  else
    printf "   ${YELLOW}⚠️  Nenhum log de coleta encontrado ainda${NC}\n"
  fi
else
  printf "   ${YELLOW}⚠️  Diretório de logs não existe${NC}\n"
fi

# 9. Teste de execução manual (opcional)
printf "\n${BLUE}9. Teste de execução manual (opcional)...${NC}\n"
printf "   Para testar manualmente, execute:\n"
printf "   ${YELLOW}$COLLECT_SCRIPT${NC}\n"

# Resumo final
printf "\n╔═══════════════════════════════════════════════════════════╗\n"
printf "║  📋 RESUMO                                                ║\n"
printf "╚═══════════════════════════════════════════════════════════╝\n\n"

# Contar verificações OK
CHECKS_OK=0
CHECKS_TOTAL=0

# Alpine
CHECKS_TOTAL=$((CHECKS_TOTAL + 1))
[ -f /etc/alpine-release ] && CHECKS_OK=$((CHECKS_OK + 1))

# Shell (BusyBox)
CHECKS_TOTAL=$((CHECKS_TOTAL + 1))
readlink /bin/sh 2>/dev/null | grep -q "busybox" && CHECKS_OK=$((CHECKS_OK + 1))

# Node.js
CHECKS_TOTAL=$((CHECKS_TOTAL + 1))
command -v node >/dev/null 2>&1 && CHECKS_OK=$((CHECKS_OK + 1))

# crond
CHECKS_TOTAL=$((CHECKS_TOTAL + 1))
pgrep crond >/dev/null 2>&1 && CHECKS_OK=$((CHECKS_OK + 1))

# crontab
CHECKS_TOTAL=$((CHECKS_TOTAL + 1))
crontab -l >/dev/null 2>&1 && CHECKS_OK=$((CHECKS_OK + 1))

# PATH no crontab
CHECKS_TOTAL=$((CHECKS_TOTAL + 1))
crontab -l 2>/dev/null | grep -q "^PATH=" && CHECKS_OK=$((CHECKS_OK + 1))

# COLLECT_SCRIPT existe
CHECKS_TOTAL=$((CHECKS_TOTAL + 1))
[ -f "$COLLECT_SCRIPT" ] && CHECKS_OK=$((CHECKS_OK + 1))

# SETUP_SCRIPT existe
CHECKS_TOTAL=$((CHECKS_TOTAL + 1))
[ -f "$SETUP_SCRIPT" ] && CHECKS_OK=$((CHECKS_OK + 1))

# Sintaxe COLLECT_SCRIPT
CHECKS_TOTAL=$((CHECKS_TOTAL + 1))
[ -f "$COLLECT_SCRIPT" ] && sh -n "$COLLECT_SCRIPT" 2>/dev/null && CHECKS_OK=$((CHECKS_OK + 1))

# Sintaxe SETUP_SCRIPT
CHECKS_TOTAL=$((CHECKS_TOTAL + 1))
[ -f "$SETUP_SCRIPT" ] && sh -n "$SETUP_SCRIPT" 2>/dev/null && CHECKS_OK=$((CHECKS_OK + 1))

# Diretório de logs
CHECKS_TOTAL=$((CHECKS_TOTAL + 1))
[ -d "$LOG_DIR" ] && CHECKS_OK=$((CHECKS_OK + 1))

printf "Status: ${CHECKS_OK}/${CHECKS_TOTAL} verificações OK\n\n"

if [ "$CHECKS_OK" -eq "$CHECKS_TOTAL" ]; then
  printf "${GREEN}✅ Sistema configurado corretamente!${NC}\n"
  printf "${GREEN}   Cron jobs estão prontos para executar.${NC}\n"
  exit 0
elif [ "$CHECKS_OK" -ge $((CHECKS_TOTAL * 2 / 3)) ]; then
  printf "${YELLOW}⚠️  Sistema parcialmente configurado${NC}\n"
  printf "${YELLOW}   Verifique os itens marcados acima.${NC}\n"
  exit 0
else
  printf "${RED}❌ Configuração incompleta${NC}\n"
  printf "${RED}   Corrija os problemas antes de usar cron.${NC}\n"
  exit 1
fi
