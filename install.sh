#!/bin/sh

# Script de Instalação do HashPanel
# Executa a instalação e configuração inicial dentro do container

set -e  # Para execução em caso de erro

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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
echo "${BLUE}╔════════════════════════════════════════╗${NC}"
echo "${BLUE}║   HashPanel - Script de Instalação    ║${NC}"
echo "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Verificar se está no diretório correto
if [ ! -f "package.json" ]; then
    error "package.json não encontrado. Execute este script no diretório raiz do projeto."
    exit 1
fi

info "Iniciando instalação do HashPanel..."

# 1. Verificar Node.js e npm
info "Verificando Node.js e npm..."
if ! command -v node >/dev/null 2>&1; then
    error "Node.js não encontrado!"
    exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
    error "npm não encontrado!"
    exit 1
fi

NODE_VERSION=$(node -v)
NPM_VERSION=$(npm -v)
success "Node.js: $NODE_VERSION | npm: $NPM_VERSION"

# 2. Criar diretórios necessários
info "Criando diretórios necessários..."
mkdir -p logs
success "Diretório 'logs' criado/verificado"

# 3. Instalar dependências
info "Instalando dependências npm..."
if [ "$1" = "--production" ] || [ "$NODE_ENV" = "production" ]; then
    info "Modo produção: instalando apenas dependências de produção"
    npm ci --only=production
else
    info "Modo desenvolvimento: instalando todas as dependências"
    npm install
fi

if [ $? -eq 0 ]; then
    success "Dependências instaladas com sucesso"
else
    error "Falha ao instalar dependências"
    exit 1
fi

# 4. Verificar variáveis de ambiente
info "Verificando configuração de variáveis de ambiente..."

# Variáveis obrigatórias
REQUIRED_VARS="MASTODON_URL CLIENT_KEY CLIENT_SECRET ACCESS_TOKEN"
MISSING_VARS=""

for var in $REQUIRED_VARS; do
    eval value=\$$var
    if [ -z "$value" ]; then
        MISSING_VARS="$MISSING_VARS $var"
    fi
done

if [ -n "$MISSING_VARS" ]; then
    warning "Variáveis de ambiente obrigatórias não configuradas:"
    for var in $MISSING_VARS; do
        echo "  - $var"
    done
    echo ""
    info "Configure essas variáveis no docker-compose.yml ou crie um arquivo .env"
    echo ""
    info "Exemplo de configuração no docker-compose.yml:"
    echo "  environment:"
    echo "    - MASTODON_URL=https://sua-instancia.mastodon"
    echo "    - CLIENT_KEY=seu_client_key"
    echo "    - CLIENT_SECRET=seu_client_secret"
    echo "    - ACCESS_TOKEN=seu_access_token"
else
    success "Todas as variáveis de ambiente obrigatórias estão configuradas"
fi

# 5. Verificar permissões do diretório logs
info "Verificando permissões do diretório logs..."
if [ -w "logs" ]; then
    success "Diretório logs tem permissão de escrita"
else
    warning "Diretório logs pode não ter permissão de escrita"
    info "Tentando corrigir permissões..."
    chmod 755 logs || warning "Não foi possível alterar permissões (pode ser normal no container)"
fi

# 6. Resumo final
echo ""
echo "${GREEN}╔════════════════════════════════════════╗${NC}"
echo "${GREEN}║     Instalação Concluída!             ║${NC}"
echo "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""

info "Próximos passos:"
echo "  1. Verifique se todas as variáveis de ambiente estão configuradas"
echo "  2. Inicie o servidor com: ${GREEN}npm run server${NC}"
echo "  3. Ou use o CLI com: ${GREEN}npm start${NC}"
echo ""

if [ -n "$MISSING_VARS" ]; then
    warning "ATENÇÃO: Configure as variáveis de ambiente antes de iniciar o servidor!"
    exit 1
else
    success "Sistema pronto para uso!"
    exit 0
fi
