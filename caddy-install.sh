#!/bin/sh

# Script de Instalação e Configuração do Caddy
# Para uso dentro do container Caddy oficial (caddyserver/caddy)
# Baseado em: https://github.com/caddyserver/caddy-docker

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Função para mensagens
info() {
    echo "${BLUE}[INFO]${NC} $1"
}

success() {
    echo "${GREEN}[OK]${NC} $1"
}

warning() {
    echo "${YELLOW}[AVISO]${NC} $1"
}

error() {
    echo "${RED}[ERRO]${NC} $1"
}

# Banner
echo ""
echo "${CYAN}╔════════════════════════════════════════╗${NC}"
echo "${CYAN}║   Caddy - Script de Configuração       ║${NC}"
echo "${CYAN}╚════════════════════════════════════════╝${NC}"
echo ""

# 1. Verificar se está no container Caddy
info "Verificando ambiente Caddy..."

if ! command -v caddy >/dev/null 2>&1; then
    error "Caddy não encontrado! Este script deve ser executado no container Caddy."
    exit 1
fi

CADDY_VERSION=$(caddy version | head -n1)
success "Caddy encontrado: $CADDY_VERSION"

# 2. Verificar estrutura de diretórios
info "Verificando estrutura de diretórios..."

CADDYFILE_PATH="/etc/caddy/Caddyfile"
CADDY_CONFIG_DIR="/config"
CADDY_DATA_DIR="/data"

# Verificar se os diretórios padrão existem
if [ -d "$CADDY_CONFIG_DIR" ]; then
    success "Diretório de configuração encontrado: $CADDY_CONFIG_DIR"
else
    warning "Diretório de configuração não encontrado: $CADDY_CONFIG_DIR"
    info "Criando diretório..."
    mkdir -p "$CADDY_CONFIG_DIR" 2>/dev/null || warning "Não foi possível criar (pode ser normal)"
fi

if [ -d "$CADDY_DATA_DIR" ]; then
    success "Diretório de dados encontrado: $CADDY_DATA_DIR"
else
    warning "Diretório de dados não encontrado: $CADDY_DATA_DIR"
fi

# 3. Verificar Caddyfile
info "Verificando Caddyfile..."

if [ -f "$CADDYFILE_PATH" ]; then
    success "Caddyfile encontrado: $CADDYFILE_PATH"
    info "Conteúdo do Caddyfile:"
    echo "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    cat "$CADDYFILE_PATH" | sed 's/^/  /'
    echo "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    # Validar sintaxe do Caddyfile
    info "Validando sintaxe do Caddyfile..."
    if caddy validate --config "$CADDYFILE_PATH" 2>/dev/null; then
        success "Caddyfile válido!"
    else
        error "Caddyfile contém erros de sintaxe!"
        caddy validate --config "$CADDYFILE_PATH" || true
        exit 1
    fi
else
    warning "Caddyfile não encontrado em: $CADDYFILE_PATH"
    info "Locais comuns para Caddyfile:"
    echo "  - /etc/caddy/Caddyfile"
    echo "  - /config/Caddyfile"
    echo "  - ./Caddyfile (diretório atual)"
    echo ""
    info "Você pode criar um Caddyfile baseado no exemplo: Caddyfile.example"
fi

# 4. Verificar conectividade com hashpanel
info "Verificando conectividade com container hashpanel..."

# Tentar diferentes métodos de teste
HASHPANEL_HOST="hashpanel"
HASHPANEL_PORT="3000"

if command -v nc >/dev/null 2>&1; then
    if nc -z -w2 "$HASHPANEL_HOST" "$HASHPANEL_PORT" 2>/dev/null; then
        success "Conectividade com $HASHPANEL_HOST:$HASHPANEL_PORT OK"
    else
        warning "Não foi possível conectar a $HASHPANEL_HOST:$HASHPANEL_PORT"
        info "Verifique se:"
        echo "  1. O container hashpanel está rodando"
        echo "  2. Ambos containers estão na mesma rede Docker"
        echo "  3. O nome do container está correto no Caddyfile"
    fi
elif command -v wget >/dev/null 2>&1; then
    if wget -q --spider --timeout=2 "http://$HASHPANEL_HOST:$HASHPANEL_PORT/health" 2>/dev/null; then
        success "Health check do hashpanel acessível"
    else
        warning "Health check do hashpanel não acessível"
    fi
elif command -v curl >/dev/null 2>&1; then
    if curl -sf --max-time 2 "http://$HASHPANEL_HOST:$HASHPANEL_PORT/health" >/dev/null 2>&1; then
        success "Health check do hashpanel acessível"
    else
        warning "Health check do hashpanel não acessível"
    fi
else
    warning "Ferramentas de teste de conectividade não disponíveis (nc/wget/curl)"
fi

# 5. Verificar status do Caddy
info "Verificando status do Caddy..."

if pgrep -x caddy >/dev/null 2>&1; then
    success "Caddy está em execução (PID: $(pgrep -x caddy))"
else
    warning "Caddy não está em execução"
    info "Para iniciar o Caddy, use: caddy run --config $CADDYFILE_PATH"
fi

# 6. Verificar logs
info "Verificando logs..."

LOG_PATHS="/var/log/caddy /logs /data/logs"
LOG_FOUND=false

for log_path in $LOG_PATHS; do
    if [ -d "$log_path" ]; then
        success "Diretório de logs encontrado: $log_path"
        LOG_FOUND=true
        if [ -n "$(ls -A $log_path 2>/dev/null)" ]; then
            info "Arquivos de log encontrados:"
            ls -lh "$log_path" | tail -5 | sed 's/^/  /'
        fi
        break
    fi
done

if [ "$LOG_FOUND" = false ]; then
    warning "Nenhum diretório de logs encontrado nos locais padrão"
fi

# 7. Resumo e recomendações
echo ""
echo "${CYAN}╔════════════════════════════════════════╗${NC}"
echo "${CYAN}║     Verificação Concluída!             ║${NC}"
echo "${CYAN}╚════════════════════════════════════════╝${NC}"
echo ""

info "Próximos passos:"
echo ""
echo "  1. ${GREEN}Validar configuração:${NC}"
echo "     caddy validate --config $CADDYFILE_PATH"
echo ""
echo "  2. ${GREEN}Testar configuração (dry-run):${NC}"
echo "     caddy adapt --config $CADDYFILE_PATH"
echo ""
echo "  3. ${GREEN}Recarregar configuração (se Caddy estiver rodando):${NC}"
echo "     caddy reload --config $CADDYFILE_PATH"
echo ""
echo "  4. ${GREEN}Ver logs em tempo real:${NC}"
echo "     tail -f /var/log/caddy/*.log"
echo ""

success "Configuração do Caddy verificada!"
