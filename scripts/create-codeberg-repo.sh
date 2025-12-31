#!/bin/bash

# Script para criar um repositório no Codeberg
# Uso: ./scripts/create-codeberg-repo.sh [username] [repo-name] [token]
# Ou via variáveis de ambiente: CODEBERG_USER, CODEBERG_REPO, CODEBERG_TOKEN

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Função para solicitar input se não fornecido
get_input() {
    local prompt="$1"
    local var_name="$2"
    local value="${!var_name}"
    
    if [ -z "$value" ]; then
        echo -ne "${BLUE}$prompt: ${NC}"
        read -r value
    fi
    echo "$value"
}

# Obter username (argumento, variável de ambiente ou prompt)
if [ -n "$1" ]; then
    USERNAME="$1"
elif [ -n "$CODEBERG_USER" ]; then
    USERNAME="$CODEBERG_USER"
else
    USERNAME=$(get_input "Nome de usuário do Codeberg" "USERNAME")
fi

# Obter nome do repositório (argumento, variável de ambiente ou prompt)
if [ -n "$2" ]; then
    REPO_NAME="$2"
elif [ -n "$CODEBERG_REPO" ]; then
    REPO_NAME="$CODEBERG_REPO"
else
    # Tentar usar o nome do projeto do package.json como padrão
    DEFAULT_REPO=$(node -e "console.log(require('./package.json').name || '')" 2>/dev/null || echo "")
    if [ -n "$DEFAULT_REPO" ]; then
        echo -ne "${BLUE}Nome do repositório [$DEFAULT_REPO]: ${NC}"
        read -r REPO_NAME
        REPO_NAME=${REPO_NAME:-$DEFAULT_REPO}
    else
        REPO_NAME=$(get_input "Nome do repositório" "REPO_NAME")
    fi
fi

# Obter token (argumento, variável de ambiente ou prompt)
if [ -n "$3" ]; then
    TOKEN="$3"
elif [ -n "$CODEBERG_TOKEN" ]; then
    TOKEN="$CODEBERG_TOKEN"
else
    echo -e "${YELLOW}Para obter um token:${NC}"
    echo "  1. Acesse https://codeberg.org/user/settings/applications"
    echo "  2. Crie um novo token com permissão 'repo'"
    echo ""
    TOKEN=$(get_input "Token de acesso do Codeberg" "TOKEN")
fi

# Validações
if [ -z "$USERNAME" ] || [ -z "$REPO_NAME" ] || [ -z "$TOKEN" ]; then
    echo -e "${RED}Erro: Username, nome do repositório e token são obrigatórios${NC}"
    exit 1
fi
API_URL="https://codeberg.org/api/v1/user/repos"

echo -e "${YELLOW}Criando repositório '$REPO_NAME' para usuário '$USERNAME' no Codeberg...${NC}"

# Ler informações do package.json para descrição
if [ -f "package.json" ]; then
    DESCRIPTION=$(node -e "console.log(require('./package.json').description || '')" 2>/dev/null || echo "")
    if [ -z "$DESCRIPTION" ]; then
        DESCRIPTION=""
    fi
else
    DESCRIPTION=""
fi

# Fazer requisição para criar o repositório
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL" \
  -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"$REPO_NAME\",
    \"description\": \"$DESCRIPTION\",
    \"private\": false,
    \"auto_init\": false
  }")

# Separar body e status code
HTTP_BODY=$(echo "$RESPONSE" | head -n -1)
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)

if [ "$HTTP_CODE" -eq 201 ]; then
    echo -e "${GREEN}✓ Repositório criado com sucesso!${NC}"
    
    # Extrair URL do clone do JSON
    if command -v jq &> /dev/null; then
        CLONE_URL=$(echo "$HTTP_BODY" | jq -r '.clone_url // .ssh_url // empty' 2>/dev/null || echo "")
        HTML_URL=$(echo "$HTTP_BODY" | jq -r '.html_url // empty' 2>/dev/null || echo "")
    else
        # Fallback: usar grep/sed se jq não estiver disponível
        CLONE_URL=$(echo "$HTTP_BODY" | grep -oE '"clone_url":"[^"]*"' | sed 's/"clone_url":"\(.*\)"/\1/' | head -1 || echo "")
        HTML_URL=$(echo "$HTTP_BODY" | grep -oE '"html_url":"[^"]*"' | sed 's/"html_url":"\(.*\)"/\1/' | head -1 || echo "")
    fi
    
    # Construir URL padrão se não encontrada
    if [ -z "$CLONE_URL" ]; then
        CLONE_URL="https://codeberg.org/$USERNAME/$REPO_NAME.git"
    fi
    if [ -z "$HTML_URL" ]; then
        HTML_URL="https://codeberg.org/$USERNAME/$REPO_NAME"
    fi
    
    echo ""
    echo -e "${GREEN}URL do repositório: ${HTML_URL}${NC}"
    echo -e "${GREEN}URL para clone: ${CLONE_URL}${NC}"
    echo ""
    echo -e "${YELLOW}Próximos passos:${NC}"
    echo "  1. Adicionar remote do Codeberg (mantém GitHub como origin):"
    echo -e "     ${BLUE}git remote add codeberg $CLONE_URL${NC}"
    echo ""
    echo "  2. Ou substituir o remote origin:"
    echo -e "     ${BLUE}git remote set-url origin $CLONE_URL${NC}"
    echo ""
    echo "  3. Fazer push para Codeberg:"
    echo -e "     ${BLUE}git push -u codeberg main${NC}"
    echo ""
    echo "  4. Ou fazer push para ambos (GitHub e Codeberg):"
    echo -e "     ${BLUE}git push origin main && git push codeberg main${NC}"
else
    echo -e "${RED}✗ Erro ao criar repositório (HTTP $HTTP_CODE)${NC}"
    if command -v jq &> /dev/null; then
        echo "$HTTP_BODY" | jq . 2>/dev/null || echo "$HTTP_BODY"
    else
        echo "$HTTP_BODY"
    fi
    exit 1
fi
