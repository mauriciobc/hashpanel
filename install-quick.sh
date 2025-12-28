#!/bin/sh

# Script de Instalação Rápida do HashPanel
# Versão simplificada para reinstalação rápida de dependências

set -e

# Cores
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "${BLUE}[INFO]${NC} Instalando dependências..."

if [ "$1" = "--production" ]; then
    npm ci --only=production
else
    npm install
fi

echo "${GREEN}[OK]${NC} Dependências instaladas!"
