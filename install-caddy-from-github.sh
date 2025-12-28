#!/bin/sh

# Script simplificado para instalar/configurar Caddy via GitHub
# Uso: 
#   ./install-caddy-from-github.sh install    - Instalação completa
#   ./install-caddy-from-github.sh setup       - Setup rápido
#   ./install-caddy-from-github.sh test       - Testes

set -e

GITHUB_REPO="${GITHUB_REPO:-mauriciobc/hashpanel}"
GITHUB_BRANCH="${GITHUB_BRANCH:-main}"

SCRIPT_TYPE="${1:-install}"

case "$SCRIPT_TYPE" in
    install|install.sh|caddy-install)
        SCRIPT_FILE="caddy-install.sh"
        ;;
    setup|caddy-setup|caddy-setup.sh)
        SCRIPT_FILE="caddy-setup.sh"
        ;;
    test|caddy-test|caddy-test.sh)
        SCRIPT_FILE="caddy-test.sh"
        ;;
    *)
        echo "❌ Tipo inválido: $SCRIPT_TYPE"
        echo ""
        echo "Uso: $0 [install|setup|test]"
        exit 1
        ;;
esac

URL="https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/${SCRIPT_FILE}"

echo "📥 Baixando script do Caddy: $SCRIPT_FILE"
echo "   Repositório: ${GITHUB_REPO}"
echo "   Branch: ${GITHUB_BRANCH}"
echo ""

if command -v curl >/dev/null 2>&1; then
    curl -sfL "$URL" | sh -s -- "${@:2}"
elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$URL" | sh -s -- "${@:2}"
else
    echo "❌ Erro: curl ou wget não encontrado"
    exit 1
fi
