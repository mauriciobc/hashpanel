#!/bin/sh

# Script seguro para instalar/configurar Caddy via GitHub
# Uso: 
#   ./install-caddy-from-github.sh install [--yes] [--inspect]    - Instalação completa
#   ./install-caddy-from-github.sh setup [--yes] [--inspect]       - Setup rápido
#   ./install-caddy-from-github.sh test [--yes] [--inspect]       - Testes

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

error() { printf '%s❌ ERRO:%s %s\n' "${RED}" "${NC}" "$1" >&2; }
info() { printf '%sℹ️  INFO:%s %s\n' "${BLUE}" "${NC}" "$1"; }
success() { printf '%s✅ OK:%s %s\n' "${GREEN}" "${NC}" "$1"; }
warning() { printf '%s⚠️  AVISO:%s %s\n' "${YELLOW}" "${NC}" "$1"; }

# Configuração
GITHUB_REPO="${GITHUB_REPO:-mauriciobc/hashpanel}"
GITHUB_BRANCH="${GITHUB_BRANCH:-main}"

# Processar primeiro argumento (tipo de script)
SCRIPT_TYPE="${1:-install}"

# Flags de controle
SKIP_CONFIRM=false
INSPECT_ONLY=false

# Processar flags e argumentos adicionais
SCRIPT_ARGS=""
shift 2>/dev/null || true
for arg in "$@"; do
    case "$arg" in
        --yes|-y)
            SKIP_CONFIRM=true
            ;;
        --inspect|-i)
            INSPECT_ONLY=true
            ;;
        *)
            SCRIPT_ARGS="${SCRIPT_ARGS} ${arg}"
            ;;
    esac
done

# Mapear tipo de script
case "$SCRIPT_TYPE" in
    install|install.sh|caddy-install)
        SCRIPT_FILE="caddy-install.sh"
        SCRIPT_NAME="Caddy (Instalação)"
        ;;
    setup|caddy-setup|caddy-setup.sh)
        SCRIPT_FILE="caddy-setup.sh"
        SCRIPT_NAME="Caddy (Setup)"
        ;;
    test|caddy-test|caddy-test.sh)
        SCRIPT_FILE="caddy-test.sh"
        SCRIPT_NAME="Caddy (Testes)"
        ;;
    *)
        error "Tipo inválido: $SCRIPT_TYPE"
        echo ""
        info "Uso: $0 [install|setup|test] [--yes] [--inspect]"
        exit 1
        ;;
esac

URL="https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/${SCRIPT_FILE}"
TEMP_SCRIPT=$(mktemp /tmp/caddy-install-XXXXXX.sh)

# Checksum esperado (opcional - pode ser definido via variável de ambiente)
# Exemplo: EXPECTED_SHA256_CADDY_INSTALL, EXPECTED_SHA256_CADDY_SETUP, etc.
EXPECTED_SHA256_VAR="EXPECTED_SHA256_$(echo "$SCRIPT_FILE" | tr '[:lower:]' '[:upper:]' | tr '-' '_' | sed 's/\.SH$//')"
EXPECTED_SHA256=$(eval "echo \${${EXPECTED_SHA256_VAR}:-}")

# Função de limpeza
cleanup() {
    if [ -f "$TEMP_SCRIPT" ]; then
        rm -f "$TEMP_SCRIPT"
    fi
}

# Configurar trap para limpeza em caso de saída
trap cleanup EXIT INT TERM

# Verificar ferramentas necessárias
if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
    error "curl ou wget não encontrado. Instale um deles para continuar."
    exit 1
fi

# Verificar se sha256sum está disponível (para verificação de checksum)
HAS_SHA256SUM=false
if command -v sha256sum >/dev/null 2>&1; then
    HAS_SHA256SUM=true
elif command -v shasum >/dev/null 2>&1; then
    HAS_SHA256SUM=true
fi

echo ""
info "Baixando script do Caddy: ${SCRIPT_NAME}"
echo "   Arquivo: ${SCRIPT_FILE}"
echo "   Repositório: ${GITHUB_REPO}"
echo "   Branch: ${GITHUB_BRANCH}"
echo "   URL: ${URL}"
echo ""

# Baixar script para arquivo temporário
if command -v curl >/dev/null 2>&1; then
    if ! curl -sfL "$URL" -o "$TEMP_SCRIPT" 2>/dev/null; then
        error "Falha ao baixar o script de instalação"
        error "Verifique a conexão e se a URL está acessível: ${URL}"
        exit 1
    fi
elif command -v wget >/dev/null 2>&1; then
    if ! wget -q "$URL" -O "$TEMP_SCRIPT" 2>/dev/null; then
        error "Falha ao baixar o script de instalação"
        error "Verifique a conexão e se a URL está acessível: ${URL}"
        exit 1
    fi
fi

# Verificar se o arquivo foi baixado corretamente
if [ ! -f "$TEMP_SCRIPT" ] || [ ! -s "$TEMP_SCRIPT" ]; then
    error "O arquivo baixado está vazio ou não existe"
    exit 1
fi

success "Script baixado com sucesso para: ${TEMP_SCRIPT}"

# Calcular checksum do arquivo baixado
if [ "$HAS_SHA256SUM" = true ]; then
    if command -v sha256sum >/dev/null 2>&1; then
        ACTUAL_SHA256=$(sha256sum "$TEMP_SCRIPT" | cut -d' ' -f1)
    else
        ACTUAL_SHA256=$(shasum -a 256 "$TEMP_SCRIPT" | cut -d' ' -f1)
    fi
    
    info "SHA256 do script baixado: ${ACTUAL_SHA256}"
    
    # Verificar checksum se EXPECTED_SHA256 foi fornecido
    if [ -n "$EXPECTED_SHA256" ]; then
        EXPECTED_SHA256=$(echo "$EXPECTED_SHA256" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')
        ACTUAL_SHA256_LOWER=$(echo "$ACTUAL_SHA256" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')
        
        if [ "$ACTUAL_SHA256_LOWER" != "$EXPECTED_SHA256" ]; then
            error "Verificação de checksum falhou!"
            error "Esperado: ${EXPECTED_SHA256}"
            error "Obtido:   ${ACTUAL_SHA256_LOWER}"
            error "O script pode ter sido comprometido ou corrompido."
            exit 1
        fi
        
        success "Verificação de checksum SHA256 passou"
    else
        warning "EXPECTED_SHA256 não definido - pulando verificação de integridade"
        warning "Para segurança adicional, defina ${EXPECTED_SHA256_VAR} antes de executar"
    fi
else
    warning "sha256sum não disponível - pulando verificação de integridade"
fi

# Opção de inspeção
if [ "$INSPECT_ONLY" = true ]; then
    info "Modo de inspeção ativado. Abrindo o script para revisão..."
    echo ""
    
    # Tentar abrir com editor padrão ou usar cat
    if [ -n "${EDITOR:-}" ]; then
        info "Abrindo com editor: ${EDITOR}"
        "$EDITOR" "$TEMP_SCRIPT"
    elif command -v less >/dev/null 2>&1; then
        less "$TEMP_SCRIPT"
    elif command -v more >/dev/null 2>&1; then
        more "$TEMP_SCRIPT"
    else
        cat "$TEMP_SCRIPT"
    fi
    
    echo ""
    info "Script salvo em: ${TEMP_SCRIPT}"
    info "Você pode revisar o arquivo e executá-lo manualmente se desejar."
    exit 0
fi

# Confirmação do usuário (a menos que --yes seja usado)
if [ "$SKIP_CONFIRM" = false ]; then
    echo ""
    warning "Você está prestes a executar um script baixado da internet."
    echo ""
    info "Script: ${SCRIPT_NAME}"
    info "Arquivo temporário: ${TEMP_SCRIPT}"
    if [ -n "$EXPECTED_SHA256" ]; then
        info "SHA256 verificado: ${ACTUAL_SHA256}"
    else
        info "SHA256: ${ACTUAL_SHA256}"
    fi
    echo ""
    printf "Deseja continuar? [s/N]: "
    read -r response
    case "$response" in
        [sS][iI][mM]|[sS]|[yY][eE][sS]|[yY])
            info "Continuando com a execução..."
            ;;
        *)
            info "Execução cancelada pelo usuário"
            exit 0
            ;;
    esac
fi

# Executar o script verificado
echo ""
info "Executando script: ${SCRIPT_NAME}"
echo ""

# Tornar o script executável
chmod +x "$TEMP_SCRIPT"

# Executar o script com os argumentos passados
if sh "$TEMP_SCRIPT" $SCRIPT_ARGS; then
    success "Script executado com sucesso"
    exit 0
else
    EXIT_CODE=$?
    error "Script falhou com código de saída: ${EXIT_CODE}"
    exit $EXIT_CODE
fi
