#!/bin/sh

# Script de Setup Rápido do Caddy
# Cria um Caddyfile básico para o hashpanel

set -e

# Cores
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo "${BLUE}[INFO]${NC} $1"; }
success() { echo "${GREEN}[OK]${NC} $1"; }
warning() { echo "${YELLOW}[AVISO]${NC} $1"; }

echo ""
echo "${CYAN}╔════════════════════════════════════════╗${NC}"
echo "${CYAN}║   Caddy - Setup Rápido                ║${NC}"
echo "${CYAN}╚════════════════════════════════════════╝${NC}"
echo ""

# Parse arguments
FORCE=false
CADDYFILE_PATH="/etc/caddy/Caddyfile"

while [ $# -gt 0 ]; do
    case "$1" in
        --force|-f)
            FORCE=true
            ;;
        *)
            if [ -z "$CADDYFILE_PATH" ] || [ "$CADDYFILE_PATH" = "/etc/caddy/Caddyfile" ]; then
                CADDYFILE_PATH="$1"
            fi
            ;;
    esac
    shift
done

HASHPANEL_HOST="${HASHPANEL_HOST:-hashpanel}"
HASHPANEL_PORT="${HASHPANEL_PORT:-3000}"
CADDY_PORT="${CADDY_PORT:-32768}"

info "Criando Caddyfile em: $CADDYFILE_PATH"

# Verificar se já existe
if [ -f "$CADDYFILE_PATH" ] && [ "$FORCE" = false ]; then
    warning "Caddyfile já existe!"
    echo ""
    info "Conteúdo atual:"
    echo "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    cat "$CADDYFILE_PATH" | sed 's/^/  /'
    echo "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    info "Use --force ou -f para sobrescrever:"
    echo "  ./caddy-setup.sh --force"
    echo "  ./caddy-setup.sh --force /caminho/alternativo/Caddyfile"
    exit 1
fi

# Criar diretório se não existir
mkdir -p "$(dirname "$CADDYFILE_PATH")" 2>/dev/null || true

# Criar Caddyfile
cat > "$CADDYFILE_PATH" << EOF
# Configuração do Caddy para HashPanel
# Gerado automaticamente por caddy-setup.sh

:$CADDY_PORT {
    reverse_proxy $HASHPANEL_HOST:$HASHPANEL_PORT {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
        
        # Health check
        health_uri /health
        health_interval 30s
        health_timeout 3s
    }
    
    # Compressão
    encode gzip zstd
    
    # Logs
    log {
        output file /var/log/caddy/hashpanel.log
        format console
    }
}
EOF

success "Caddyfile criado com sucesso!"
echo ""
info "Configuração:"
echo "  - Porta Caddy: $CADDY_PORT"
echo "  - Backend: $HASHPANEL_HOST:$HASHPANEL_PORT"
echo ""
info "Para validar:"
echo "  caddy validate --config $CADDYFILE_PATH"
echo ""
info "Para testar:"
echo "  ./caddy-test.sh"
echo ""

success "Setup concluído!"
