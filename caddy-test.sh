#!/bin/sh

# Script de Teste do Caddy
# Testa conectividade e configuração do Caddy com hashpanel

set -e

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

info() { echo "${BLUE}[TESTE]${NC} $1"; }
success() { echo "${GREEN}[OK]${NC} $1"; }
error() { echo "${RED}[FALHOU]${NC} $1"; }
warning() { echo "${YELLOW}[AVISO]${NC} $1"; }

echo ""
echo "${CYAN}╔════════════════════════════════════════╗${NC}"
echo "${CYAN}║   Caddy - Testes de Conectividade      ║${NC}"
echo "${CYAN}╚════════════════════════════════════════╝${NC}"
echo ""

HASHPANEL_HOST="${HASHPANEL_HOST:-hashpanel}"
HASHPANEL_PORT="${HASHPANEL_PORT:-3000}"
CADDY_PORT="${CADDY_PORT:-32768}"

# Teste 1: Conectividade direta com hashpanel
info "Teste 1: Conectividade direta com hashpanel ($HASHPANEL_HOST:$HASHPANEL_PORT)"

if command -v nc >/dev/null 2>&1; then
    if nc -z -w2 "$HASHPANEL_HOST" "$HASHPANEL_PORT" 2>/dev/null; then
        success "Porta $HASHPANEL_PORT acessível"
    else
        error "Porta $HASHPANEL_PORT não acessível"
    fi
else
    warning "nc (netcat) não disponível, pulando teste de porta"
fi

# Teste 2: Health check direto do hashpanel
info "Teste 2: Health check direto do hashpanel"

if command -v wget >/dev/null 2>&1; then
    if wget -q --spider --timeout=3 "http://$HASHPANEL_HOST:$HASHPANEL_PORT/health" 2>/dev/null; then
        success "Health check OK"
        RESPONSE=$(wget -qO- --timeout=3 "http://$HASHPANEL_HOST:$HASHPANEL_PORT/health" 2>/dev/null || echo "")
        if [ -n "$RESPONSE" ]; then
            echo "  Resposta: $RESPONSE"
        fi
    else
        error "Health check falhou"
    fi
elif command -v curl >/dev/null 2>&1; then
    RESPONSE=$(curl -sf --max-time 3 "http://$HASHPANEL_HOST:$HASHPANEL_PORT/health" 2>/dev/null || echo "")
    if [ -n "$RESPONSE" ]; then
        success "Health check OK"
        echo "  Resposta: $RESPONSE"
    else
        error "Health check falhou"
    fi
else
    warning "wget/curl não disponíveis, pulando teste HTTP"
fi

# Teste 3: Teste através do Caddy (se estiver rodando)
info "Teste 3: Teste através do Caddy (porta $CADDY_PORT)"

if command -v wget >/dev/null 2>&1; then
    if wget -q --spider --timeout=3 "http://localhost:$CADDY_PORT/health" 2>/dev/null; then
        success "Caddy proxy funcionando"
        RESPONSE=$(wget -qO- --timeout=3 "http://localhost:$CADDY_PORT/health" 2>/dev/null || echo "")
        if [ -n "$RESPONSE" ]; then
            echo "  Resposta: $RESPONSE"
        fi
    else
        warning "Caddy proxy não acessível (pode não estar rodando ou configurado)"
    fi
elif command -v curl >/dev/null 2>&1; then
    RESPONSE=$(curl -sf --max-time 3 "http://localhost:$CADDY_PORT/health" 2>/dev/null || echo "")
    if [ -n "$RESPONSE" ]; then
        success "Caddy proxy funcionando"
        echo "  Resposta: $RESPONSE"
    else
        warning "Caddy proxy não acessível (pode não estar rodando ou configurado)"
    fi
else
    warning "wget/curl não disponíveis, pulando teste do proxy"
fi

# Teste 4: Validação do Caddyfile
info "Teste 4: Validação do Caddyfile"

CADDYFILE_PATH="/etc/caddy/Caddyfile"
if [ -f "$CADDYFILE_PATH" ]; then
    if command -v caddy >/dev/null 2>&1; then
        if caddy validate --config "$CADDYFILE_PATH" 2>/dev/null; then
            success "Caddyfile válido"
        else
            error "Caddyfile contém erros"
            caddy validate --config "$CADDYFILE_PATH" 2>&1 | head -5 || true
        fi
    else
        warning "Caddy não encontrado, não é possível validar"
    fi
else
    warning "Caddyfile não encontrado em $CADDYFILE_PATH"
fi

echo ""
success "Testes concluídos!"
