#!/bin/bash

# Script para configurar autenticação do Codeberg
# Oferece opções: Token no URL, SSH, ou Git Credential Helper

set -e

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}⚙️  Configuração de Autenticação do Codeberg${NC}"
echo ""
echo "Escolha o método de autenticação:"
echo ""
echo "  1) ${GREEN}Token no URL${NC} - Simples, mas token fica no .git/config"
echo "  2) ${GREEN}SSH${NC} - Mais seguro, recomendado (usa chave SSH)"
echo "  3) ${GREEN}Git Credential Helper${NC} - Salva token no sistema"
echo "  4) ${YELLOW}Ver configuração atual${NC}"
echo ""
echo -ne "${BLUE}Sua escolha (1-4): ${NC}"
read -r choice

case "$choice" in
    1)
        echo ""
        echo -e "${YELLOW}⚠️  Nota: O token será salvo em texto plano no .git/config${NC}"
        echo ""
        echo "Para obter um token:"
        echo "  1. Acesse: https://codeberg.org/user/settings/applications"
        echo "  2. Generate New Token com escopo 'repo'"
        echo ""
        echo -ne "${BLUE}Username do Codeberg: ${NC}"
        read -r username
        echo -ne "${BLUE}Token: ${NC}"
        read -s token
        echo ""
        
        # Atualizar remote com token
        git remote set-url codeberg "https://${username}:${token}@codeberg.org/${username}/hashpanel.git"
        
        echo ""
        echo -e "${GREEN}✓ Remote atualizado com token${NC}"
        echo -e "${YELLOW}⚠️  Token salvo em: .git/config${NC}"
        ;;
        
    2)
        echo ""
        echo -e "${CYAN}Configurando SSH...${NC}"
        echo ""
        
        # Verificar se há chave SSH
        if [ ! -f ~/.ssh/id_ed25519 ] && [ ! -f ~/.ssh/id_rsa ]; then
            echo -e "${YELLOW}Nenhuma chave SSH encontrada. Deseja criar uma? (s/n): ${NC}"
            read -r create_key
            if [ "$create_key" = "s" ] || [ "$create_key" = "S" ]; then
                echo -ne "${BLUE}Email para a chave SSH: ${NC}"
                read -r email
                ssh-keygen -t ed25519 -C "$email" -f ~/.ssh/id_ed25519
                echo ""
                echo -e "${GREEN}✓ Chave SSH criada${NC}"
            else
                echo -e "${RED}✗ Cancelado. Configure uma chave SSH primeiro.${NC}"
                exit 1
            fi
        fi
        
        # Detectar qual chave existe
        SSH_KEY=""
        if [ -f ~/.ssh/id_ed25519.pub ]; then
            SSH_KEY="~/.ssh/id_ed25519.pub"
            KEY_FILE="$HOME/.ssh/id_ed25519.pub"
        elif [ -f ~/.ssh/id_rsa.pub ]; then
            SSH_KEY="~/.ssh/id_rsa.pub"
            KEY_FILE="$HOME/.ssh/id_rsa.pub"
        fi
        
        if [ -n "$SSH_KEY" ]; then
            echo ""
            echo -e "${CYAN}Adicione esta chave pública ao Codeberg:${NC}"
            echo ""
            cat "$KEY_FILE"
            echo ""
            echo ""
            echo "1. Acesse: https://codeberg.org/user/settings/keys"
            echo "2. Clique em 'Add Key'"
            echo "3. Cole a chave acima"
            echo ""
            echo -ne "${BLUE}Pressione Enter quando tiver adicionado a chave...${NC}"
            read -r
            
            # Atualizar remote para SSH
            git remote set-url codeberg "git@codeberg.org:mauriciobc/hashpanel.git"
            
            echo ""
            echo -e "${GREEN}✓ Remote configurado para SSH${NC}"
            echo -e "${CYAN}Teste a conexão com: ssh -T git@codeberg.org${NC}"
        fi
        ;;
        
    3)
        echo ""
        echo -e "${CYAN}Configurando Git Credential Helper...${NC}"
        echo ""
        echo "Para obter um token:"
        echo "  1. Acesse: https://codeberg.org/user/settings/applications"
        echo "  2. Generate New Token com escopo 'repo'"
        echo ""
        echo -ne "${BLUE}Username do Codeberg: ${NC}"
        read -r username
        
        # Configurar credential helper para Codeberg
        git config credential.helper store
        
        echo ""
        echo -e "${GREEN}✓ Credential helper configurado${NC}"
        echo -e "${CYAN}Na próxima vez que fizer push, digite:${NC}"
        echo "  Username: $username"
        echo "  Password: <seu-token>"
        echo ""
        echo -e "${YELLOW}As credenciais serão salvas automaticamente.${NC}"
        ;;
        
    4)
        echo ""
        echo -e "${CYAN}Configuração atual:${NC}"
        echo ""
        echo "Remotes:"
        git remote -v | grep codeberg
        echo ""
        echo "Credential helper:"
        git config --get credential.helper || echo "Não configurado"
        echo ""
        echo "SSH config:"
        if [ -f ~/.ssh/config ]; then
            grep -A 5 "codeberg.org" ~/.ssh/config 2>/dev/null || echo "Não configurado"
        else
            echo "Arquivo ~/.ssh/config não existe"
        fi
        ;;
        
    *)
        echo -e "${RED}Opção inválida${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}✓ Configuração concluída!${NC}"
