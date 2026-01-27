#!/bin/sh
# scripts/update-inside-container.sh
# Script executado dentro do container para atualizar o código e dependências.

set -e

# Cores para output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { printf "${YELLOW}[INFO]${NC} %s\n" "$1"; }
success() { printf "${GREEN}[OK]${NC} %s\n" "$1"; }
error() { printf "${RED}[ERRO]${NC} %s\n" "$1"; }

cd /app

# 1. Verificar se git está instalado
if ! command -v git >/dev/null 2>&1; then
    info "Git não encontrado. Instalando..."
    apk add --no-cache git || { error "Falha ao instalar git"; exit 1; }
fi

# 2. Backup do commit atual
OLD_COMMIT=$(git rev-parse HEAD)
info "Commit atual: $OLD_COMMIT"

# 3. Fetch das mudanças
info "Buscando atualizações do GitHub..."
git fetch origin main || { error "Falha ao buscar atualizações"; exit 1; }

# 4. Verificar mudanças no package.json
PKG_CHANGED=0
if ! git diff --quiet HEAD origin/main -- package.json; then
    PKG_CHANGED=1
    info "Mudanças detectadas no package.json."
fi

# 5. Reset para a nova versão
info "Atualizando arquivos para origin/main..."
git reset --hard origin/main || { error "Falha ao resetar para origin/main"; exit 1; }

# 6. Instalar dependências se necessário
if [ "$PKG_CHANGED" = "1" ]; then
    info "Instalando/Atualizando dependências (npm ci)..."
    # Otimização para Alpine 32-bit e recursos limitados
    npm ci --omit=dev --no-audit --no-fund || { error "Falha ao instalar dependências"; exit 1; }
    success "Dependências atualizadas."
else
    info "Nenhuma mudança nas dependências."
fi

# 7. Executar migrações
info "Executando migrações do banco de dados..."
npm run db:migrate || info "Nenhuma migração nova ou falha ignorada."

success "Atualização interna concluída com sucesso."
echo "$OLD_COMMIT" # Retorna o commit antigo para o host poder fazer rollback se necessário
