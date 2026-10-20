#!/bin/sh
# scripts/update-inside-container.sh
# Script executado dentro do container para atualizar o código e dependências.

set -e

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

# 4. Verificar mudanças nas dependências
DEPS_CHANGED=0
if ! git diff --quiet HEAD origin/main -- pyproject.toml; then
    DEPS_CHANGED=1
    info "Mudanças detectadas no pyproject.toml."
fi

# 5. Reset para a nova versão
info "Atualizando arquivos para origin/main..."
git reset --hard origin/main || { error "Falha ao resetar para origin/main"; exit 1; }

# 6. Instalar dependências se necessário
if [ "$DEPS_CHANGED" = "1" ]; then
    info "Instalando/Atualizando dependências (pip)..."
    pip install --no-cache-dir . || { error "Falha ao instalar dependências"; exit 1; }
    success "Dependências atualizadas."
else
    info "Nenhuma mudança nas dependências."
fi

# 7. Executar as migrações do banco de dados
info "Executando migrações do banco de dados..."
python -c "from hashpanel.database.connection import get_database; get_database().close()" \
    || info "Nenhuma migração nova ou falha ignorada."

success "Atualização interna concluída com sucesso."
echo "$OLD_COMMIT" # Retorna o commit antigo para o host poder fazer rollback se necessário
