# HashPanel

Sistema para monitorar hashtags diárias no Mastodon, coletar dados históricos e fornecer um dashboard web para visualização de estatísticas e análise de tendências.

## 📋 Sobre o Projeto

O HashPanel é uma aplicação Node.js que:
- 🔍 Monitora hashtags específicas do Mastodon por dia da semana
- 📊 Coleta e armazena dados históricos de uso de hashtags
- 📈 Fornece um dashboard web para visualização de estatísticas
- 🤖 Gera e publica resumos diários automaticamente (opcional)
- 📱 Calcula relevância de posts baseado em interações e seguidores
- 🎨 Gera imagens de dashboard com temas claro/escuro
- 💬 Bot automático que responde a mentions com relatórios

## ✨ Funcionalidades

- **Monitoramento Diário**: Acompanha hashtags diferentes para cada dia da semana
- **Dashboard Web**: Interface web para visualizar estatísticas em tempo real
- **Histórico de Dados**: Armazena histórico semanal de uso de hashtags
- **Cálculo de Relevância**: Algoritmo inteligente para identificar posts mais relevantes
- **API RESTful**: Endpoints para integração e automação
- **CLI Interativa**: Interface de linha de comando para operações diárias
- **Coleção Automatizada**: Sistema de coleta de dados via cron jobs
- **Bot de Mentions**: Responde automaticamente a mentions com relatórios de hashtags
- **Geração de Imagens**: Cria imagens de dashboard com temas claro/escuro
- **Proxy de Mídia**: Proxy de imagens para evitar problemas de CORS
- **♿ Acessibilidade**: Descrições ALT detalhadas em todas as imagens (WCAG 2.1 AA)

## 🛠️ Tecnologias

- **Node.js** (ES Modules)
- **Express.js** - Servidor web
- **SQLite** (better-sqlite3) - Banco de dados
- **Mastodon API** - Integração com Mastodon
- **Canvas** - Geração de imagens de dashboard
- **WebSocket** - Conexão em tempo real para bot de mentions
- **Winston** - Sistema de logs estruturado
- **Moment.js** - Manipulação de datas e timezones
- **Zod** - Validação de configuração
- **Node-Cache** - Cache em memória

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
CLIENT_KEY=your_client_key_here
CLIENT_SECRET=your_client_secret_here
ACCESS_TOKEN=seu_token_aqui

# Servidor
PORT=3000
HOST=0.0.0.0
SERVER_PUBLIC_URL=http://localhost:3000
NODE_ENV=development

# CORS (apenas produção)
CORS_ORIGIN=https://seu-dominio.com

# Timezone (opcional, padrão: America/Sao_Paulo)
PREFERRED_TIMEZONE=America/Sao_Paulo

# Trust Proxy (opcional, padrão: 1)
TRUST_PROXY=1

# Telemetry (opcional)
# TELEMETRY_ENDPOINT=https://your-telemetry-server.com/ingest/your-token
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

## ⏰ Fusos Horários (Timezone)

O HashPanel possui suporte completo e automático para fusos horários, garantindo que usuários em qualquer parte do mundo vejam informações corretas.

### Como Funciona

- 📍 **Detecção Automática**: O dashboard detecta automaticamente o fuso horário do navegador do usuário
- 🌍 **Suporte Global**: Suporta todos os fusos horários IANA (mais de 400 fusos horários)
- 📅 **Hashtag Diária**: Calculada com base no dia atual do USUÁRIO, não do servidor
- 🕐 **Datas e Horários**: Todos os timestamps são ajustados automaticamente para o fuso horário do usuário
- 📊 **Telemetria**: Coleta estatísticas anônimas sobre uso de fusos horários

### Configuração do Servidor

O fuso horário padrão do servidor pode ser configurado via variável de ambiente:

```bash
# Fuso horário padrão (usado para coleta de dados do servidor)
PREFERRED_TIMEZONE=America/Sao_Paulo
```

Fusos horários válidos seguem o padrão IANA. Exemplos:
- `America/Sao_Paulo` (Brasil - UTC-3)
- `America/New_York` (Nova York - UTC-5/UTC-4)
- `Europe/London` (Londres - UTC/UTC+1)
- `Asia/Tokyo` (Tóquio - UTC+9)
- `UTC` (Horário Universal Coordenado)

[Lista completa de fusos horários](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)

### Para Usuários

- Todas as datas e horários são exibidos no **seu** fuso horário local
- A hashtag diária muda à meia-noite do **seu** horário, não do servidor
- Passe o mouse sobre datas para ver informações do fuso horário em uso
- O console do navegador mostra qual fuso horário foi detectado

**Exemplo**: Se são 23:00 de segunda-feira no Brasil e 11:00 de terça-feira no Japão:
- Usuário no Brasil vê: `#segundaficha` (hashtag de segunda-feira)
- Usuário no Japão vê: `#tercinema` (hashtag de terça-feira)

### Telemetria

Visualize estatísticas de uso de fusos horários:
```bash
GET /api/dashboard/telemetry
```

O sistema detecta automaticamente o fuso horário do navegador e ajusta todas as informações de acordo.

## 🤖 Bot de Mentions Automático

O HashPanel inclui um bot que responde automaticamente a mentions no Mastodon, fornecendo relatórios de hashtags em tempo real.

### Como Funciona

1. **Conexão WebSocket**: O bot se conecta ao streaming API do Mastodon
2. **Detecção de Mentions**: Monitora mentions diretas ao bot
3. **Análise de Hashtags**: Extrai hashtags mencionadas na mensagem
4. **Geração de Relatório**: Cria imagem de dashboard com estatísticas
5. **Resposta Automática**: Publica resposta com imagem e dados

### Uso

Mencione o bot em um post com uma hashtag:

```
@seu_bot me mostra dados da #tercinema
```

O bot responderá automaticamente com:
- Imagem de dashboard da hashtag
- Estatísticas resumidas
- Link para o dashboard completo

### Configuração

O bot inicia automaticamente quando o servidor é iniciado. Para desabilitar, remova a inicialização em `src/server/index.js`.

**Requisitos**: Node.js 21+ ou Node.js 18/20 com `--experimental-websocket`

## 🎨 Geração de Imagens de Dashboard

O sistema gera imagens de dashboard automaticamente com suporte a temas claro e escuro.

### Características

- **Temas**: Claro e escuro
- **Formato**: PNG 800x800px
- **Conteúdo**: 4 cards com estatísticas principais
- **Acessibilidade**: Descrições ALT completas (WCAG 2.1 AA)

### Uso Programático

```javascript
import { imageGenerator } from './services/imageGenerator.js';

const stats = {
  hashtag: 'tercinema',
  summary: {
    weeklyTotal: 150,
    uniqueUsers: 45,
    todayCount: 23
  }
};

const { imageBuffer, altText } = await imageGenerator.generateDashboardImage(stats, 'dark');
```

## ♿ Acessibilidade

O HashPanel implementa práticas de acessibilidade para garantir que o conteúdo seja acessível a todos os usuários, seguindo os padrões WCAG 2.1 Nível AA.

### Descrições ALT nas Imagens

Todas as imagens de dashboard geradas incluem descrições ALT completas e estruturadas que descrevem todos os 4 cards com informações detalhadas:

**Exemplo de descrição ALT gerada:**
```
Dashboard HashPanel para #tercinema. 
Dados organizados em 4 cards: 
Card 1: Total da semana - 150 posts. 
Card 2: Participantes únicos - 45 usuários. 
Card 3: Posts hoje - 23 posts. 
Card 4: Hashtag atual - #tercinema.
```

**Características das descrições ALT:**
- ✅ Descreve todos os 4 cards do dashboard
- ✅ Usa singular/plural corretamente
- ✅ Estrutura em 6 partes lógicas
- ✅ Trata valores zero e dados ausentes
- ✅ Preserva caracteres especiais (acentuação)

**Conformidade**: WCAG 2.1 Nível AA (Critério 1.1.1 - Conteúdo Não-textual)

### Implementação Técnica

O sistema de geração de ALT text está implementado em `src/services/imageGenerator.js`:

- Função `generateAltText()` cria descrições estruturadas automaticamente
- Retorno de `generateDashboardImage()` inclui tanto `imageBuffer` quanto `altText`
- Todos os pontos de uso (bot de mentions, relatório diário, CLI) foram atualizados

### Beneficiários

Esta implementação beneficia especialmente:
- Usuários de leitores de tela (NVDA, JAWS, VoiceOver, TalkBack)
- Pessoas com deficiência visual
- Usuários em conexões lentas (ALT text carrega antes da imagem)
- Bots e crawlers que indexam conteúdo alternativo

### Testes de Acessibilidade

O projeto inclui 11 testes unitários específicos para validação de acessibilidade:
- Geração de texto ALT descritivo
- Tratamento de valores zero e ausentes
- Estrutura e formatação correta
- Preservação de caracteres especiais

Execute os testes com:
```bash
npm test -- tests/unit/services/imageGenerator.test.js
```

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

## 🔄 Atualização

O sistema possui um script de atualização inteligente que permite baixar as últimas mudanças do GitHub, atualizar dependências e reiniciar o servidor sem precisar reiniciar a VM ou o container Docker manualmente.

### Como funciona
1. **Backup**: Salva o estado atual do repositório.
2. **Atualização**: Faz o download do código mais recente (git fetch/reset).
3. **Dependências**: Verifica se o `package.json` mudou e reinstala dependências se necessário (`npm ci`).
4. **Reinício**: Reinicia o processo Node.js de forma segura (graceful shutdown).
5. **Validação**: Verifica se o sistema subiu corretamente via endpoint de health check.
6. **Rollback**: Se algo der errado e o servidor não subir, o script desfaz as alterações automaticamente.

### Como usar

Execute o script na raiz do projeto:

```bash
# Dar permissão de execução (apenas a primeira vez)
chmod +x update-from-github.sh

# Executar a atualização
./update-from-github.sh
```

> **Nota para Docker/Portainer**: O script detecta automaticamente o container chamado `hashpanel` e executa a atualização dentro dele. Se você usa um nome de container diferente, edite a variável `CONTAINER_NAME` no início do script.

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
│   │       ├── media.js
│   │       ├── trending.js
│   │       └── toot.js
│   ├── services/         # Serviços de negócio
│   │   ├── databaseService.js
│   │   ├── dataProcessor.js
│   │   ├── hashtagListener.js
│   │   ├── hashtagService.js
│   │   ├── historyCollector.js
│   │   ├── imageGenerator.js
│   │   ├── mastodon.js
│   │   ├── relevanceCalculator.js
│   │   ├── telemetryService.js
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

### Qualidade de Código
- `npm run lint` - Verifica problemas de linting
- `npm run lint:fix` - Corrige automaticamente problemas de linting
- `npm run format` - Formata código com Prettier
- `npm test` - Executa testes unitários
- `npm run test:watch` - Executa testes em modo watch
- `npm run test:coverage` - Executa testes com relatório de cobertura

## 📡 API Endpoints

### Health Check
- `GET /health` - Status de saúde do sistema (Mastodon API, Database, memória)

### Dashboard
- `GET /api/dashboard-data` - Dados consolidados do dashboard
- `GET /api/hashtag-stats` - Estatísticas da hashtag atual
- `GET /api/top-toots` - Posts mais relevantes
- `GET /api/trending-tags` - Hashtags em alta
- `GET /api/dashboard/telemetry` - Estatísticas de telemetria (timezones, etc.)

### Hashtags
- `GET /api/hashtag/:hashtag/stats` - Estatísticas de uma hashtag
- `GET /api/hashtag/:hashtag/history` - Histórico de uso
- `GET /api/hashtag/:hashtag/toots` - Posts da hashtag

### Posts
- `GET /api/toot/:id` - Detalhes de um post
- `GET /api/toot-embed/:id` - Embed de um post
- `POST /api/toot/validate` - Valida conteúdo antes de publicar

### Mídia
- `GET /api/media/proxy` - Proxy de imagens (evita CORS, query param: `url`)

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
- Imagens proxyadas (TTL: 1 hora, configurável)

### Proxy de Mídia

O endpoint `/api/media/proxy` permite fazer proxy de imagens para evitar problemas de CORS:
- Validação de domínios permitidos (whitelist)
- Cache de imagens em memória
- Limite de tamanho: 10MB por imagem
- Rate limiting reduzido para operações de mídia

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

### Bot de Mentions Não Responde

- Verifique se o bot está rodando: `npm run status`
- Confirme que o `ACCESS_TOKEN` tem permissões de leitura e escrita
- Verifique os logs: `npm run logs`
- Para Node.js 18/20, use `--experimental-websocket` flag
- Node.js 21+ tem suporte nativo a WebSocket

### Problemas com Geração de Imagens

- Verifique se `canvas` está instalado: `npm install canvas`
- Em sistemas Linux, pode ser necessário instalar dependências do sistema:
  ```bash
  # Ubuntu/Debian
  sudo apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
  
  # Alpine
  apk add build-base cairo-dev pango-dev jpeg-dev giflib-dev
  ```

## 🧪 Testes

O projeto inclui testes unitários usando Vitest:

```bash
# Executar todos os testes
npm test

# Modo watch (desenvolvimento)
npm run test:watch

# Com cobertura
npm run test:coverage
```

### Estrutura de Testes

- `tests/unit/` - Testes unitários por módulo
- Cobertura de serviços principais
- Testes de utilitários e helpers

## 📝 Licença

ISC

## 🤝 Contribuindo

Contribuições são bem-vindas! Por favor:
1. Faça um fork do projeto
2. Crie uma branch para sua feature (`git checkout -b feature/nova-funcionalidade`)
3. Commit suas mudanças (`git commit -m 'Adiciona nova funcionalidade'`)
4. Push para a branch (`git push origin feature/nova-funcionalidade`)
5. Abra um Pull Request

### Diretrizes de Contribuição

- Siga os padrões de código existentes
- Adicione testes para novas funcionalidades
- Atualize a documentação quando necessário
- Use commits descritivos

## 🔧 Oportunidades de Melhoria Futuras

O projeto está em constante evolução. Algumas melhorias planejadas incluem:

### Alta Prioridade
- **Logging Estruturado**: Substituir `console.log` por logger estruturado em todo o código
- **Segurança**: Auditoria completa de queries SQL para garantir uso de prepared statements
- **Tratamento de Erros**: Melhorar consistência no tratamento de promises e erros assíncronos
- **Validação**: Garantir que todos os endpoints usem validação Zod completa

### Média Prioridade
- **Performance**: Otimizar estratégia de cache e implementar cache warming
- **Monitoramento**: Adicionar métricas detalhadas e sistema de alertas
- **Testes**: Aumentar cobertura de testes e adicionar testes de integração
- **Documentação API**: Criar documentação OpenAPI/Swagger completa

### Baixa Prioridade
- **TypeScript**: Considerar migração gradual para TypeScript ou JSDoc mais rigoroso
- **Frontend**: Refatorar frontend em módulos separados
- **i18n**: Adicionar suporte a múltiplos idiomas
- **Performance**: Testes de carga e stress testing

Para contribuir com melhorias, consulte a seção [Contribuindo](#-contribuindo).

## 📧 Suporte

Para questões e suporte, abra uma issue no repositório.

---

**Desenvolvido com ❤️ para a comunidade Mastodon**
