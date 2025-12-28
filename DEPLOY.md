# Guia de Deploy - Hashpanel

Este guia explica como fazer deploy do Hashpanel usando Docker e Caddy via Portainer.

## 📋 Pré-requisitos

- Docker e Docker Compose instalados
- Portainer configurado e rodando
- Caddy configurado no Portainer
- Arquivo `.env` com as credenciais do Mastodon

## 🐳 Opção 1: Deploy via Docker Compose (Recomendado)

### 1. Preparar variáveis de ambiente

Certifique-se de que o arquivo `.env` existe na raiz do projeto com as seguintes variáveis:

```env
# Mastodon Configuration (Obrigatório)
MASTODON_URL=https://sua-instancia.mastodon/api/v1/
CLIENT_KEY=seu_client_key
CLIENT_SECRET=seu_client_secret
ACCESS_TOKEN=seu_access_token

# Server Configuration (Opcional - valores padrão mostrados)
PORT=3000
HOST=0.0.0.0
NODE_ENV=production
LOG_LEVEL=info
PREFERRED_TIMEZONE=America/Sao_Paulo

# Performance Settings (Opcional)
API_TIMEOUT_MS=30000
RATE_LIMIT_DELAY_MS=1000
MAX_API_PAGES=20
TOOTS_PER_PAGE=40

# Cache Settings (Opcional)
CACHE_TTL_SECONDS=300
ENABLE_CACHE=true
```

### 2. Build e Iniciar o Container

No Portainer:

1. **Stack Editor**: Crie uma nova stack ou edite uma existente
2. **Web Editor**: Cole o conteúdo do arquivo `docker-compose.yml`
3. **Environment variables**: Configure as variáveis de ambiente (ou use o arquivo `.env`)
4. **Deploy the stack**: Clique em "Deploy the stack"

Ou via linha de comando:

```bash
docker-compose up -d
```

### 3. Verificar o Status

```bash
# Ver logs
docker-compose logs -f hashpanel

# Verificar saúde do container
docker-compose ps

# Testar health check
curl http://localhost:3000/health
```

## 🔄 Opção 2: Deploy via Portainer Container

### 1. Build da Imagem

```bash
docker build -t hashpanel:latest .
```

Ou configure no Portainer:

1. **Images** → **Build image from Dockerfile**
2. Selecione o diretório do projeto
3. Nome da imagem: `hashpanel:latest`
4. Clique em **Build the image**

### 2. Criar Container no Portainer

1. **Containers** → **Add container**
2. Configure:
   - **Name**: `hashpanel`
   - **Image**: `hashpanel:latest`
   - **Network**: Crie ou selecione uma rede (ex: `hashpanel-network`)
   - **Port mapping**: `3000:3000` (ou deixe apenas interno se usar Caddy)
   - **Restart policy**: `Unless stopped`
   - **Environment variables**: Adicione todas as variáveis do `.env`

### 3. Health Check

Configure o health check no Portainer:

```json
{
  "test": ["CMD", "node", "-e", "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"],
  "interval": 30,
  "timeout": 3,
  "retries": 3,
  "startPeriod": 5
}
```

## 🌐 Configuração do Caddy (Reverse Proxy)

O Caddy precisa ser configurado para fazer proxy reverso do container hashpanel.

### Via Portainer (Caddy Container)

1. Acesse o container do Caddy no Portainer
2. Vá em **Exec Console** ou edite o volume onde o Caddyfile está
3. Adicione a configuração:

```caddy
:32768 {
    reverse_proxy hashpanel:3000 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
        
        # Health check
        health_uri /health
        health_interval 30s
        health_timeout 3s
    }
    
    # Compressão
    encode gzip zstd
    
    # Logs
    log {
        output file /var/log/caddy/hashpanel.log
        format console
    }
}
```

### Importante: Rede Docker

Certifique-se de que:

1. O container `hashpanel` e o container `caddy` estão na **mesma rede Docker**
2. No Caddyfile, use o nome do container (`hashpanel`) ao invés de `localhost`
3. Se necessário, crie uma rede compartilhada:

```bash
docker network create hashpanel-network
docker network connect hashpanel-network hashpanel
docker network connect hashpanel-network caddy
```

Ou configure no docker-compose.yml para que ambos os serviços usem a mesma rede.

### Scripts de Instalação e Configuração do Caddy

Scripts prontos para uso dentro do container Caddy (baseado na [imagem oficial](https://github.com/caddyserver/caddy-docker)):

#### 1. `caddy-install.sh` - Instalação e Verificação Completa

Script completo que verifica e configura o Caddy:

```bash
# Acessar o container Caddy
docker exec -it caddy sh

# Executar instalação/verificação
./caddy-install.sh
```

O script verifica:
- ✅ Versão do Caddy instalada
- ✅ Estrutura de diretórios (/config, /data)
- ✅ Existência e validade do Caddyfile
- ✅ Conectividade com o container hashpanel
- ✅ Status do processo Caddy
- ✅ Diretórios de logs

#### 2. `caddy-setup.sh` - Setup Rápido

Cria um Caddyfile básico automaticamente:

```bash
# Dentro do container Caddy
./caddy-setup.sh

# Ou especificar caminho customizado
./caddy-setup.sh /config/Caddyfile
```

Variáveis de ambiente opcionais:
- `HASHPANEL_HOST` - Nome do container hashpanel (padrão: `hashpanel`)
- `HASHPANEL_PORT` - Porta do hashpanel (padrão: `3000`)
- `CADDY_PORT` - Porta do Caddy (padrão: `32768`)

#### 3. `caddy-test.sh` - Testes de Conectividade

Testa a configuração e conectividade:

```bash
# Dentro do container Caddy
./caddy-test.sh
```

O script testa:
- 🔍 Conectividade direta com hashpanel
- 🔍 Health check do hashpanel
- 🔍 Proxy reverso através do Caddy
- 🔍 Validação do Caddyfile

#### Executar Diretamente (sem entrar no container)

```bash
# Instalação completa
docker exec caddy ./caddy-install.sh

# Setup rápido
docker exec caddy ./caddy-setup.sh

# Testes
docker exec caddy ./caddy-test.sh
```

#### Comandos Úteis do Caddy

```bash
# Validar Caddyfile
caddy validate --config /etc/caddy/Caddyfile

# Testar configuração (dry-run)
caddy adapt --config /etc/caddy/Caddyfile

# Recarregar configuração (sem downtime)
caddy reload --config /etc/caddy/Caddyfile

# Ver logs
tail -f /var/log/caddy/*.log
```

## 🔍 Verificação do Deploy

### 1. Verificar se o container está rodando

```bash
docker ps | grep hashpanel
```

### 2. Verificar logs

```bash
docker logs hashpanel -f
```

### 3. Testar endpoints

```bash
# Health check
curl http://192.168.68.114:32768/health

# API root
curl http://192.168.68.114:32768/api

# Dashboard
curl http://192.168.68.114:32768/api/dashboard/stats
```

### 4. Verificar no navegador

Acesse: `http://192.168.68.114:32768/`

## 🔧 Troubleshooting

### Container não inicia

- Verifique os logs: `docker logs hashpanel`
- Verifique se todas as variáveis de ambiente estão configuradas
- Verifique se a porta 3000 não está em uso: `lsof -i:3000`

### Caddy não consegue conectar ao hashpanel

- Verifique se ambos containers estão na mesma rede: `docker network inspect hashpanel-network`
- Teste a conectividade: `docker exec caddy ping hashpanel`
- Verifique se o nome do container no Caddyfile está correto

### Erro de permissão nos logs

```bash
docker exec hashpanel chmod -R 777 /app/logs
```

Ou configure o volume com permissões corretas no docker-compose.yml.

### Porta já em uso

Se a porta 32768 estiver em uso pelo Caddy, você pode:

1. Mudar a porta no Caddyfile
2. Ou mudar a porta interna do hashpanel (não recomendado, use proxy)

## 📝 Estrutura de Arquivos

```
hashpanel/
├── Dockerfile              # Imagem Docker
├── docker-compose.yml      # Orquestração de containers
├── .dockerignore          # Arquivos ignorados no build
├── Caddyfile.example      # Exemplo de configuração do Caddy
├── .env                   # Variáveis de ambiente (não commitado)
├── install.sh             # Script de instalação completo (hashpanel)
├── install-quick.sh        # Script de instalação rápida (hashpanel)
├── caddy-install.sh       # Script de instalação/verificação (Caddy)
├── caddy-setup.sh         # Script de setup rápido (Caddy)
├── caddy-test.sh          # Script de testes (Caddy)
├── install-from-github.sh  # Instalação via GitHub (interativo)
├── install-hashpanel-from-github.sh  # Instalação HashPanel via GitHub
├── install-caddy-from-github.sh      # Instalação Caddy via GitHub
└── DEPLOY.md              # Este arquivo
```

## 📥 Instalação via GitHub

### Instalação Automática (Recomendado)

Você pode instalar diretamente do GitHub sem precisar clonar o repositório:

#### HashPanel

```bash
# Dentro do container hashpanel ou no host
curl -sfL https://raw.githubusercontent.com/mauriciobc/hashpanel/main/install-hashpanel-from-github.sh | sh

# Ou com wget
wget -qO- https://raw.githubusercontent.com/mauriciobc/hashpanel/main/install-hashpanel-from-github.sh | sh

# Com opções (ex: modo produção)
curl -sfL https://raw.githubusercontent.com/mauriciobc/hashpanel/main/install-hashpanel-from-github.sh | sh -s -- --production
```

#### Caddy

```bash
# Dentro do container Caddy
# Instalação completa
curl -sfL https://raw.githubusercontent.com/mauriciobc/hashpanel/main/install-caddy-from-github.sh | sh -s -- install

# Setup rápido
curl -sfL https://raw.githubusercontent.com/mauriciobc/hashpanel/main/install-caddy-from-github.sh | sh -s -- setup

# Testes
curl -sfL https://raw.githubusercontent.com/mauriciobc/hashpanel/main/install-caddy-from-github.sh | sh -s -- test
```

#### Script Interativo

Para escolher qual script executar:

```bash
# Baixar e executar script interativo
curl -sfL https://raw.githubusercontent.com/mauriciobc/hashpanel/main/install-from-github.sh | sh

# Ou especificar diretamente
curl -sfL https://raw.githubusercontent.com/mauriciobc/hashpanel/main/install-from-github.sh | sh -s -- hashpanel
curl -sfL https://raw.githubusercontent.com/mauriciobc/hashpanel/main/install-from-github.sh | sh -s -- caddy
```

### Variáveis de Ambiente

Você pode customizar o repositório e branch:

```bash
# Usar branch diferente
GITHUB_BRANCH=develop curl -sfL https://raw.githubusercontent.com/mauriciobc/hashpanel/main/install-hashpanel-from-github.sh | sh

# Usar fork diferente
GITHUB_REPO=seu-usuario/hashpanel GITHUB_BRANCH=main curl -sfL https://raw.githubusercontent.com/seu-usuario/hashpanel/main/install-hashpanel-from-github.sh | sh
```

## 🔧 Instalação Manual no Container

Se você precisar instalar ou reinstalar dependências dentro do container em execução:

### Opção 1: Instalação Completa (Recomendado)

```bash
# Acessar o container
docker exec -it hashpanel sh

# Executar script de instalação completo
./install.sh

# Ou para instalação apenas de produção
./install.sh --production
```

O script `install.sh` faz:
- ✅ Verifica Node.js e npm
- ✅ Cria diretórios necessários (logs)
- ✅ Instala dependências npm
- ✅ Verifica variáveis de ambiente obrigatórias
- ✅ Verifica permissões
- ✅ Fornece feedback detalhado

### Opção 2: Instalação Rápida

Para reinstalação rápida de dependências apenas:

```bash
# Acessar o container
docker exec -it hashpanel sh

# Executar script rápido
./install-quick.sh

# Ou para produção
./install-quick.sh --production
```

### Executar Diretamente sem Entrar no Container

```bash
# Instalação completa
docker exec hashpanel ./install.sh

# Instalação rápida
docker exec hashpanel ./install-quick.sh --production
```

## 🚀 Atualizações

Para atualizar o container:

```bash
# Pull latest code
git pull

# Rebuild e restart
docker-compose up -d --build
```

Ou no Portainer:

1. **Images** → Rebuild da imagem
2. **Containers** → `hashpanel` → **Recreate** (marque "Re pull image")

## 📊 Monitoramento

- **Health Check**: `GET /health`
- **Logs**: `docker logs hashpanel -f`
- **Métricas**: O endpoint `/api/dashboard/stats` retorna estatísticas do sistema

## 🔒 Segurança

- Nunca commite o arquivo `.env` no Git
- Use secrets do Portainer para variáveis sensíveis
- Configure rate limiting adequado (já configurado no código)
- Use HTTPS no Caddy para produção
