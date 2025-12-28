# Guia de Instalação - HashPanel

Este guia explica como instalar e configurar o HashPanel usando os scripts disponíveis.

## 🚀 Instalação Rápida via GitHub

A forma mais rápida de instalar é baixando diretamente do GitHub:

### HashPanel (Container Node.js)

```bash
# Instalação completa
curl -sfL https://raw.githubusercontent.com/mauriciobc/hashpanel/main/install-hashpanel-from-github.sh | sh

# Modo produção (apenas dependências de produção)
curl -sfL https://raw.githubusercontent.com/mauriciobc/hashpanel/main/install-hashpanel-from-github.sh | sh -s -- --production
```

### Caddy (Container Reverse Proxy)

```bash
# Dentro do container Caddy

# 1. Instalação/Verificação completa
curl -sfL https://raw.githubusercontent.com/mauriciobc/hashpanel/main/install-caddy-from-github.sh | sh -s -- install

# 2. Setup rápido (cria Caddyfile)
curl -sfL https://raw.githubusercontent.com/mauriciobc/hashpanel/main/install-caddy-from-github.sh | sh -s -- setup

# 3. Testes de conectividade
curl -sfL https://raw.githubusercontent.com/mauriciobc/hashpanel/main/install-caddy-from-github.sh | sh -s -- test
```

### Script Interativo

Para escolher qual script executar:

```bash
curl -sfL https://raw.githubusercontent.com/mauriciobc/hashpanel/main/install-from-github.sh | sh
```

## 📋 Scripts Disponíveis

### Para HashPanel (Container Node.js)

| Script | Descrição | Uso |
|--------|-----------|-----|
| `install.sh` | Instalação completa com validações | `./install.sh [--production]` |
| `install-quick.sh` | Instalação rápida (apenas npm install) | `./install-quick.sh [--production]` |
| `install-hashpanel-from-github.sh` | Baixa e executa install.sh do GitHub | `curl ... \| sh` |

### Para Caddy (Container Reverse Proxy)

| Script | Descrição | Uso |
|--------|-----------|-----|
| `caddy-install.sh` | Verificação e validação completa | `./caddy-install.sh` |
| `caddy-setup.sh` | Cria Caddyfile automaticamente | `./caddy-setup.sh [--force]` |
| `caddy-test.sh` | Testes de conectividade | `./caddy-test.sh` |
| `install-caddy-from-github.sh` | Baixa e executa scripts do Caddy | `curl ... \| sh -s -- [install\|setup\|test]` |

### Script Universal

| Script | Descrição | Uso |
|--------|-----------|-----|
| `install-from-github.sh` | Menu interativo para escolher script | `./install-from-github.sh [tipo]` |

## 🔧 Uso Detalhado

### 1. Instalação no Container HashPanel

```bash
# Acessar container
docker exec -it hashpanel sh

# Opção A: Baixar do GitHub e executar
curl -sfL https://raw.githubusercontent.com/mauriciobc/hashpanel/main/install-hashpanel-from-github.sh | sh

# Opção B: Se já tiver os arquivos no container
./install.sh
./install.sh --production  # Apenas dependências de produção
```

### 2. Configuração no Container Caddy

```bash
# Acessar container
docker exec -it caddy sh

# Opção A: Baixar do GitHub e executar
curl -sfL https://raw.githubusercontent.com/mauriciobc/hashpanel/main/install-caddy-from-github.sh | sh -s -- install

# Opção B: Setup rápido (cria Caddyfile)
curl -sfL https://raw.githubusercontent.com/mauriciobc/hashpanel/main/install-caddy-from-github.sh | sh -s -- setup

# Opção C: Testes
curl -sfL https://raw.githubusercontent.com/mauriciobc/hashpanel/main/install-caddy-from-github.sh | sh -s -- test
```

### 3. Execução Direta (sem entrar no container)

```bash
# HashPanel
docker exec hashpanel sh -c "curl -sfL https://raw.githubusercontent.com/mauriciobc/hashpanel/main/install-hashpanel-from-github.sh | sh"

# Caddy - Instalação
docker exec caddy sh -c "curl -sfL https://raw.githubusercontent.com/mauriciobc/hashpanel/main/install-caddy-from-github.sh | sh -s -- install"

# Caddy - Setup
docker exec caddy sh -c "curl -sfL https://raw.githubusercontent.com/mauriciobc/hashpanel/main/install-caddy-from-github.sh | sh -s -- setup"
```

## ⚙️ Customização

### Usar Branch Diferente

```bash
GITHUB_BRANCH=develop curl -sfL https://raw.githubusercontent.com/mauriciobc/hashpanel/main/install-hashpanel-from-github.sh | sh
```

### Usar Fork Diferente

```bash
GITHUB_REPO=seu-usuario/hashpanel GITHUB_BRANCH=main \
  curl -sfL https://raw.githubusercontent.com/seu-usuario/hashpanel/main/install-hashpanel-from-github.sh | sh
```

### Variáveis de Ambiente para Caddy

```bash
# Customizar configuração do Caddy
HASHPANEL_HOST=meu-hashpanel \
HASHPANEL_PORT=3000 \
CADDY_PORT=8080 \
curl -sfL https://raw.githubusercontent.com/mauriciobc/hashpanel/main/install-caddy-from-github.sh | sh -s -- setup
```

## 🔍 Verificação

### Verificar Instalação do HashPanel

```bash
# Dentro do container
node -v
npm -v
npm list --depth=0
```

### Verificar Configuração do Caddy

```bash
# Dentro do container Caddy
caddy version
caddy validate --config /etc/caddy/Caddyfile
./caddy-test.sh
```

## 📝 Requisitos

### Para Scripts do HashPanel
- Node.js instalado
- npm instalado
- Variáveis de ambiente configuradas (MASTODON_URL, CLIENT_KEY, etc.)

### Para Scripts do Caddy
- Caddy instalado (imagem oficial)
- Container hashpanel rodando na mesma rede
- Acesso de leitura/escrita ao diretório de configuração

### Para Download do GitHub
- `curl` ou `wget` instalado
- Acesso à internet
- Repositório público ou credenciais configuradas

## 🐛 Troubleshooting

### Erro: "curl/wget não encontrado"

```bash
# Alpine Linux
apk add curl

# Debian/Ubuntu
apt-get update && apt-get install -y curl
```

### Erro: "Não foi possível baixar o script"

- Verifique conexão com internet
- Verifique se o repositório está público
- Verifique se o branch existe
- Tente usar `wget` ao invés de `curl`

### Erro: "Caddyfile não encontrado"

```bash
# Criar Caddyfile manualmente
./caddy-setup.sh

# Ou copiar do exemplo
cp Caddyfile.example /etc/caddy/Caddyfile
```

### Erro: "Container hashpanel não acessível"

```bash
# Verificar se está na mesma rede
docker network inspect hashpanel-network

# Testar conectividade
docker exec caddy ping hashpanel
```

## 📚 Referências

- [Repositório GitHub](https://github.com/mauriciobc/hashpanel)
- [Imagem Oficial do Caddy](https://github.com/caddyserver/caddy-docker)
- [Documentação de Deploy](./DEPLOY.md)
