#!/bin/sh

# Script de Instalação via GitHub
# Baixa os scripts de instalação do GitHub e executa um deles
# Repositório: https://github.com/mauriciobc/hashpanel

set -e

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

info() { echo "${BLUE}[INFO]${NC} $1"; }
success() { echo "${GREEN}[OK]${NC} $1"; }
warning() { echo "${YELLOW}[AVISO]${NC} $1"; }
error() { echo "${RED}[ERRO]${NC} $1"; }

# Configuração
GITHUB_REPO="${GITHUB_REPO:-mauriciobc/hashpanel}"
GITHUB_BRANCH="${GITHUB_BRANCH:-main}"
GITHUB_BASE_URL="https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}"
TEMP_DIR="/tmp/hashpanel-install-$$"

# Banner
echo ""
echo "${CYAN}╔════════════════════════════════════════╗${NC}"
echo "${CYAN}║   HashPanel - Instalação via GitHub   ║${NC}"
echo "${CYAN}╚════════════════════════════════════════╝${NC}"
echo ""

# Função para baixar arquivo do GitHub
download_file() {
    local file_path="$1"
    local output_path="$2"
    local url="${GITHUB_BASE_URL}/${file_path}"
    
    info "Baixando: $file_path"
    
    if command -v curl >/dev/null 2>&1; then
        if curl -sfL "$url" -o "$output_path" 2>/dev/null; then
            success "Arquivo baixado: $file_path"
            return 0
        else
            error "Falha ao baixar: $file_path"
            return 1
        fi
    elif command -v wget >/dev/null 2>&1; then
        if wget -q "$url" -O "$output_path" 2>/dev/null; then
            success "Arquivo baixado: $file_path"
            return 0
        else
            error "Falha ao baixar: $file_path"
            return 1
        fi
    else
        error "curl ou wget não encontrado. Instale um deles para continuar."
        return 1
    fi
}

# Verificar ferramentas necessárias
info "Verificando ferramentas necessárias..."

if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
    error "curl ou wget é necessário para baixar os arquivos"
    exit 1
fi

success "Ferramentas de download disponíveis"

# Criar diretório temporário
mkdir -p "$TEMP_DIR"
trap "rm -rf $TEMP_DIR" EXIT INT TERM

# Menu de seleção
SCRIPT_TYPE=""
if [ -n "$1" ]; then
    SCRIPT_TYPE="$1"
else
    echo ""
    info "Qual script você deseja executar?"
    echo ""
    echo "  1) ${GREEN}hashpanel${NC} - Instalação do HashPanel (Node.js)"
    echo "  2) ${GREEN}caddy${NC} - Instalação/Configuração do Caddy"
    echo "  3) ${GREEN}caddy-setup${NC} - Setup rápido do Caddy"
    echo "  4) ${GREEN}caddy-test${NC} - Testes do Caddy"
    echo ""
    read -p "Escolha uma opção (1-4) ou digite o nome: " choice
    
    case "$choice" in
        1|hashpanel|install)
            SCRIPT_TYPE="hashpanel"
            ;;
        2|caddy|caddy-install)
            SCRIPT_TYPE="caddy"
            ;;
        3|caddy-setup|setup)
            SCRIPT_TYPE="caddy-setup"
            ;;
        4|caddy-test|test)
            SCRIPT_TYPE="caddy-test"
            ;;
        *)
            error "Opção inválida: $choice"
            exit 1
            ;;
    esac
fi

# Mapear scripts
case "$SCRIPT_TYPE" in
    hashpanel|install|hashpanel-install)
        SCRIPT_FILE="install.sh"
        SCRIPT_NAME="HashPanel"
        ;;
    caddy|caddy-install)
        SCRIPT_FILE="caddy-install.sh"
        SCRIPT_NAME="Caddy (Instalação)"
        ;;
    caddy-setup|setup)
        SCRIPT_FILE="caddy-setup.sh"
        SCRIPT_NAME="Caddy (Setup)"
        ;;
    caddy-test|test)
        SCRIPT_FILE="caddy-test.sh"
        SCRIPT_NAME="Caddy (Testes)"
        ;;
    *)
        error "Tipo de script inválido: $SCRIPT_TYPE"
        echo ""
        info "Tipos disponíveis:"
        echo "  - hashpanel (ou install)"
        echo "  - caddy (ou caddy-install)"
        echo "  - caddy-setup (ou setup)"
        echo "  - caddy-test (ou test)"
        exit 1
        ;;
esac

info "Script selecionado: $SCRIPT_NAME"
info "Repositório: ${GITHUB_REPO}"
info "Branch: ${GITHUB_BRANCH}"
echo ""

# Baixar script
SCRIPT_PATH="${TEMP_DIR}/${SCRIPT_FILE}"

if ! download_file "$SCRIPT_FILE" "$SCRIPT_PATH"; then
    error "Não foi possível baixar o script: $SCRIPT_FILE"
    info "Verifique se o repositório e branch estão corretos:"
    echo "  GITHUB_REPO=${GITHUB_REPO}"
    echo "  GITHUB_BRANCH=${GITHUB_BRANCH}"
    exit 1
fi

# Tornar executável
chmod +x "$SCRIPT_PATH"

# Executar script
echo ""
echo "${CYAN}╔════════════════════════════════════════╗${NC}"
echo "${CYAN}║   Executando Script de Instalação     ║${NC}"
echo "${CYAN}╚════════════════════════════════════════╝${NC}"
echo ""

# Passar argumentos adicionais para o script
shift 2>/dev/null || true
exec "$SCRIPT_PATH" "$@"
