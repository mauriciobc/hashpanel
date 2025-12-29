# HashPanel

Sistema para monitorar hashtags diárias no Mastodon, coletar dados históricos e fornecer um dashboard web para visualização de estatísticas e análise de tendências.

## 📋 Sobre o Projeto

O HashPanel é uma aplicação Node.js que:
- 🔍 Monitora hashtags específicas do Mastodon por dia da semana
- 📊 Coleta e armazena dados históricos de uso de hashtags
- 📈 Fornece um dashboard web para visualização de estatísticas
- 🤖 Gera e publica resumos diários automaticamente (opcional)
- 📱 Calcula relevância de posts baseado em interações e seguidores

## ✨ Funcionalidades

- **Monitoramento Diário**: Acompanha hashtags diferentes para cada dia da semana
- **Dashboard Web**: Interface web para visualizar estatísticas em tempo real
- **Histórico de Dados**: Armazena histórico semanal de uso de hashtags
- **Cálculo de Relevância**: Algoritmo inteligente para identificar posts mais relevantes
- **API RESTful**: Endpoints para integração e automação
- **CLI Interativa**: Interface de linha de comando para operações diárias
- **Coleção Automatizada**: Sistema de coleta de dados via cron jobs

## 🛠️ Tecnologias

- **Node.js** (ES Modules)
- **Express.js** - Servidor web
- **SQLite** (better-sqlite3) - Banco de dados
- **Mastodon API** - Integração com Mastodon
- **Winston** - Sistema de logs estruturado
- **Moment.js** - Manipulação de datas e timezones
- **Zod** - Validação de configuração

## 📦 Requisitos

- Node.js 18+ 
- npm ou yarn
- Conta no Mastodon com token de acesso
- (Opcional) Servidor web (Caddy, Nginx) para produção

## 🚀 Instalação

### Instalação Rápida

```bash
# Clone o repositório
git clone <repository-url>
cd hashpanel

# Instale as dependências
npm install

# Configure as variáveis de ambiente
cp .env.example .env
# Edite o arquivo .env com suas credenciais
```

### Instalação via Script

```bash
# Instalação automatizada
bash install.sh
```

## ⚙️ Configuração

Crie um arquivo `.env` na raiz do projeto com as seguintes variáveis:

```env
# Mastodon API
MASTODON_URL=https://sua-instancia.mastodon.social/api/v1/
ACCESS_TOKEN=seu_token_aqui

# Servidor
PORT=3000
NODE_ENV=development

# CORS (apenas produção)
CORS_ORIGIN=https://seu-dominio.com

# Timezone (opcional, padrão: America/Sao_Paulo)
PREFERRED_TIMEZONE=America/Sao_Paulo
```

### Como Obter o Access Token

1. Acesse sua instância Mastodon
2. Vá em **Preferências** → **Desenvolvimento**
3. Crie uma nova aplicação
4. Copie o **Access Token** gerado

### Hashtags Configuradas

As hashtags são definidas em `src/constants/index.js` e variam por dia da semana:

- **Domingo**: `videomingo`, `silentsunday`
- **Segunda**: `segundaficha`
- **Terça**: `tercinema`, `tersoftware`
- **Quarta**: `quartacapa`, `quartoon`, `rabisquarta`
- **Quinta**: `musiquinta`, `quintattoo`
- **Sexta**: `sextaserie`
- **Sábado**: `sabafoto`

## 📖 Como Usar

### CLI - Interface de Linha de Comando

```bash
# Executar coletor de histórico
npm run collect:history

# Status do sistema
npm start status

# Análise de dados
npm start analyze

# Migrar banco de dados
npm run db:migrate

# Limpar banco de dados (cuidado!)
npm run db:clear
```

### Servidor Web - Dashboard

```bash
# Iniciar servidor de produção
npm run server

# Modo desenvolvimento com auto-reload
npm run dev

# Acesse o dashboard em:
# http://localhost:3000
```

### Configurar Coleta Automática (Cron)

```bash
# Configurar job de coleta diária
npm run cron:setup

# Testar script de coleta
npm run cron:test
```

## 📁 Estrutura do Projeto

```
hashpanel/
├── src/
│   ├── cli/              # Interface de linha de comando
│   │   ├── index.js
│   │   └── collectHistory.js
│   ├── config/           # Configurações e validação
│   │   └── index.js
│   ├── constants/        # Constantes da aplicação
│   │   └── index.js
│   ├── database/         # Serviço de banco de dados
│   │   ├── index.js
│   │   └── migrations.js
│   ├── errors/           # Classes de erro customizadas
│   │   └── index.js
│   ├── middleware/       # Middlewares Express
│   │   ├── errorHandler.js
│   │   └── rateLimiter.js
│   ├── server/           # Servidor web Express
│   │   ├── index.js
│   │   └── routes/       # Rotas da API
│   │       ├── dashboard.js
│   │       ├── hashtag.js
│   │       ├── trending.js
│   │       └── toot.js
│   ├── services/         # Serviços de negócio
│   │   ├── databaseService.js
│   │   ├── dataProcessor.js
│   │   ├── hashtagService.js
│   │   ├── historyCollector.js
│   │   ├── mastodon.js
│   │   ├── relevanceCalculator.js
│   │   └── tootService.js
│   └── utils/            # Utilitários
│       ├── linkGenerator.js
│       └── logger.js
├── public/               # Arquivos estáticos (frontend)
│   └── index.html
├── scripts/              # Scripts auxiliares
│   ├── cron-collect-history.sh
│   └── setup-cron.sh
├── data/                 # Banco de dados SQLite (gitignored)
├── logs/                 # Logs da aplicação (gitignored)
├── cli.js               # Entry point CLI
├── server-new.js        # Entry point servidor
├── package.json
└── .env                 # Variáveis de ambiente (não commitar!)
```

## 🎯 Scripts Disponíveis

### Desenvolvimento
- `npm run dev` - Inicia servidor em modo desenvolvimento com auto-reload
- `npm run dev:server` - Servidor com nodemon
- `npm run dev:cli` - CLI com nodemon
- `npm run dev:watch` - Watch em toda pasta `src`

### Produção
- `npm start` - Inicia CLI principal
- `npm run server` - Inicia servidor web
- `npm run status` - Mostra status do sistema
- `npm run analyze` - Análise de dados

### Dados e Banco
- `npm run collect:history` - Coleta histórico de hashtags
- `npm run db:migrate` - Executa migrações do banco
- `npm run db:clear` - Limpa banco de dados
- `npm run test:weekly` - Testa coleta semanal

### Logs e Diagnóstico
- `npm run logs` - Visualiza logs em tempo real
- `npm run diagnose:collection` - Diagnostica problemas de coleta
- `npm run clean` - Limpa cache e logs

### Cron Jobs
- `npm run cron:setup` - Configura coleta automática
- `npm run cron:test` - Testa script de coleta

## 📡 API Endpoints

### Dashboard
- `GET /api/dashboard-data` - Dados consolidados do dashboard
- `GET /api/hashtag-stats` - Estatísticas da hashtag atual
- `GET /api/top-toots` - Posts mais relevantes
- `GET /api/trending-tags` - Hashtags em alta

### Hashtags
- `GET /api/hashtag/:hashtag/stats` - Estatísticas de uma hashtag
- `GET /api/hashtag/:hashtag/history` - Histórico de uso
- `GET /api/hashtag/:hashtag/toots` - Posts da hashtag

### Posts
- `GET /api/toot/:id` - Detalhes de um post
- `GET /api/toot-embed/:id` - Embed de um post

### Trending
- `GET /api/trending` - Hashtags trending
- `GET /api/trending/tags` - Lista de tags em alta

## 🔧 Configuração Avançada

### CORS em Produção

Em produção, configure `CORS_ORIGIN` no `.env`:

```env
CORS_ORIGIN=https://seu-dominio.com,https://www.seu-dominio.com
```

### Rate Limiting

O servidor implementa rate limiting:
- 100 requisições por IP a cada 15 minutos
- Configurável em `src/constants/index.js`

### Logs

Logs estruturados são salvos em:
- `logs/combined.log` - Todos os logs
- `logs/error.log` - Apenas erros
- `logs/exceptions.log` - Exceções não tratadas
- `logs/rejections.log` - Promise rejections

### Cache

O sistema utiliza cache em memória para:
- Estatísticas de hashtags (TTL: 10 minutos)
- Tags trending (TTL: 15 minutos)
- Dados gerais (TTL: 5 minutos)

## 🐛 Solução de Problemas

### Erro de Autenticação
- Verifique se `ACCESS_TOKEN` está correto no `.env`
- Confirme que o token tem permissões adequadas

### Erro de Conexão
- Verifique se `MASTODON_URL` está correto
- Confirme conectividade com a instância Mastodon

### Problemas de Banco de Dados
```bash
# Execute migrações
npm run db:migrate

# Verifique logs
npm run logs
```

### Problemas de Coleta
```bash
# Diagnostique problemas
npm run diagnose:collection

# Teste coleta manual
npm run collect:history
```

## 📝 Licença

ISC

## 🤝 Contribuindo

Contribuições são bem-vindas! Por favor:
1. Faça um fork do projeto
2. Crie uma branch para sua feature
3. Commit suas mudanças
4. Abra um Pull Request

## 📧 Suporte

Para questões e suporte, abra uma issue no repositório.

---

**Desenvolvido com ❤️ para a comunidade Mastodon**
