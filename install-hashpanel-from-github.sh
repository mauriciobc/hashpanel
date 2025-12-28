#!/bin/sh

# Script simplificado para instalar HashPanel via GitHub
# Uso: ./install-hashpanel-from-github.sh [--production]

set -e

GITHUB_REPO="${GITHUB_REPO:-mauriciobc/hashpanel}"
GITHUB_BRANCH="${GITHUB_BRANCH:-main}"
URL="https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/install.sh"

echo "📥 Baixando script de instalação do HashPanel..."
echo "   Repositório: ${GITHUB_REPO}"
echo "   Branch: ${GITHUB_BRANCH}"
echo ""

if command -v curl >/dev/null 2>&1; then
    curl -sfL "$URL" | sh -s -- "$@"
elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$URL" | sh -s -- "$@"
else
    echo "❌ Erro: curl ou wget não encontrado"
    exit 1
fi
