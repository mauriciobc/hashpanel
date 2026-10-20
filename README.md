# HashPanel

Sistema para monitorar hashtags diárias no Mastodon, coletar dados históricos e
fornecer um dashboard web para visualização de estatísticas e análise de
tendências.

## 📋 Sobre o Projeto

O HashPanel é uma aplicação Python que:
- 🔍 Monitora hashtags específicas do Mastodon por dia da semana
- 📊 Coleta e armazena dados históricos de uso de hashtags
- 📈 Fornece um dashboard web para visualização de estatísticas
- 🤖 Gera e publica resumos diários automaticamente (opcional)
- 📱 Calcula relevância de posts baseado em interações e seguidores
- 🎨 Gera imagens de dashboard com temas claro/escuro
- 💬 Bot automático que responde a menções com relatórios

## ✨ Funcionalidades

- **Monitoramento Diário**: Acompanha hashtags diferentes para cada dia da semana
- **Dashboard Web**: Interface web para visualizar estatísticas em tempo real
- **Histórico de Dados**: Armazena histórico semanal de uso de hashtags
- **Cálculo de Relevância**: Algoritmo inteligente para identificar posts mais relevantes
- **API RESTful**: Endpoints para integração e automação
- **CLI Interativa**: Interface de linha de comando para operações diárias
- **Coleta Automatizada**: Coleta de dados via cron job
- **Bot de Menções**: Responde automaticamente a menções com relatórios de hashtags
- **Geração de Imagens**: Cria imagens de dashboard com temas claro/escuro
- **Proxy de Mídia**: Proxy de imagens para evitar problemas de CORS
- **♿ Acessibilidade**: Descrições ALT detalhadas em todas as imagens (WCAG 2.1 AA)

## 🛠️ Tecnologias

- **Python 3.11+**
- **FastAPI** - Servidor web
- **SQLite** (`sqlite3` da stdlib) - Banco de dados
- **Mastodon.py** - Cliente da API do Mastodon
- **Pillow** - Geração de imagens de dashboard
- **WebSocket** - Conexão em tempo real para o bot de menções
- **Pydantic Settings** - Validação de configuração
- **pytest** - Testes

## 📦 Requisitos

- Python 3.11 ou superior
- Conta no Mastodon com token de acesso
- (Opcional) Servidor web (Caddy, Nginx) para produção

## 🚀 Instalação

### Instalação Rápida

```bash
# Clone o repositório
git clone <repository-url>
cd hashpanel

# Crie o ambiente virtual e instale o projeto
python -m venv .venv
source .venv/bin/activate
pip install -e .

# Configure as variáveis de ambiente
cp .env.example .env
# Edite o arquivo .env com suas credenciais
```

### Desenvolvimento

```bash
# Instale também as ferramentas de desenvolvimento
pip install -e ".[dev]"

# Rode os testes
pytest

# Rode o lint
ruff check src tests
```

## 🔧 Configuração

Todas as variáveis ficam no arquivo `.env` (veja `.env.example` para a lista
completa). As obrigatórias são:

| Variável | Descrição |
|---|---|
| `MASTODON_URL` | URL da instância. Pode ser a raiz (`https://exemplo.com`) ou incluir `/api/v1` — o HashPanel normaliza. |
| `CLIENT_KEY` | Chave da aplicação no Mastodon. |
| `CLIENT_SECRET` | Segredo da aplicação no Mastodon. |
| `ACCESS_TOKEN` | Token de acesso da conta do bot. |
| `CORS_ORIGIN` | Origem permitida. **Obrigatório em produção.** |

Opcionais relevantes: `PREFERRED_TIMEZONE` (padrão `America/Sao_Paulo`),
`PORT` (3000), `SERVER_PUBLIC_URL`, `TRUST_PROXY`, `RATE_LIMIT_DELAY_MS`,
`MAX_API_PAGES`, `CACHE_TTL_SECONDS`, `DB_PATH`.

## 🎯 Uso

### Servidor web

```bash
hashpanel-server
# ou
uvicorn hashpanel.server.app:app --host 0.0.0.0 --port 3000
```

O dashboard fica em `http://localhost:3000` e a API a partir de `/api`.

### CLI

```bash
hashpanel                    # análise do dia (resumo + tags em alta)
hashpanel --dry-run          # gera o resumo sem publicar
hashpanel analyze <hashtag>  # analisa uma hashtag específica
hashpanel status             # estado da aplicação e teste da API
hashpanel report             # publica o relatório do dia com imagem
hashpanel report --dry-run   # gera a imagem sem publicar
hashpanel report --light     # relatório com tema claro
hashpanel help               # ajuda completa
```

### Coleta de histórico

```bash
hashpanel-collect                  # coleta de hoje
hashpanel-collect --date 2026-01-15
hashpanel-collect --range 2026-01-01 2026-01-31
hashpanel-collect --last-7-days
```

A coleta também roda por cron dentro do container (ver `docker-entrypoint.sh`).
O script `scripts/cron-collect-history.sh` faz a coleta e publica o relatório
diário em sequência.

## 🐳 Docker

```bash
cp .env.example .env
# edite o .env com suas credenciais

docker compose up -d --build
```

- `docker-compose.yml` — aplicação com logs e banco em bind mount no host.
- `docker-compose.portainer.yml` — mesma aplicação com volumes nomeados, Caddy e
  Cloudflared opcionais.

## 🗂️ Hashtags do dia

Configuradas em `src/hashpanel/constants.py`:

| Dia | Hashtags |
|---|---|
| Domingo | `#videomingo` `#silentsunday` |
| Segunda | `#segundaficha` |
| Terça | `#tercinema` `#tersoftware` |
| Quarta | `#quartacapa` `#quartoon` `#rabisquarta` |
| Quinta | `#musiquinta` `#quintattoo` |
| Sexta | `#sextaserie` |
| Sábado | `#sabafoto` |

## 📊 API

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | Estado de cada serviço (200 ou 503) |
| GET | `/api` | Índice da API |
| GET | `/api/dashboard/stats` | Estatísticas da hashtag do dia |
| GET | `/api/dashboard/summary` | Resumo rápido do dia |
| GET | `/api/dashboard/timeline` | Série de uso dos últimos dias |
| GET | `/api/dashboard/performance` | Métricas do processo |
| GET | `/api/dashboard/alerts` | Alertas do sistema |
| GET | `/api/dashboard/telemetry` | Fusos horários dos visitantes |
| GET | `/api/hashtag/current` | Hashtag do dia |
| GET | `/api/hashtag/daily` | Grade semanal de hashtags |
| GET | `/api/hashtag/{hashtag}/stats` | Estatísticas de uma hashtag |
| GET | `/api/hashtag/{hashtag}/timeline` | Série temporal de uso |
| GET | `/api/hashtag/{hashtag}/analysis` | Análise completa |
| GET | `/api/hashtag/{hashtag}/users` | Participantes mais ativos |
| GET | `/api/hashtag/{hashtag}/history/weekly` | Histórico semanal (`year`, `week`, `date`, `daily`) |
| GET | `/api/hashtag/history/weekly` | Histórico de todas as hashtags |
| GET | `/api/trending` | Tags em alta (`limit`, `offset`) |
| GET | `/api/trending/summary` | Resumo das tags em alta |
| GET | `/api/trending/compare` | Compara de 2 a 5 tags |
| GET | `/api/trending/{tag}` | Detalhes de uma tag |
| POST | `/api/toot/generate` | Gera o resumo sem publicar |
| POST | `/api/toot/post` | Publica um post |
| POST | `/api/toot/daily` | Publica o resumo do dia |
| POST | `/api/toot/daily-image` | Publica o relatório com imagem |
| GET | `/api/toot/history` | Histórico de publicações |
| GET | `/api/toot/stats` | Estatísticas de publicação |
| POST | `/api/toot/validate` | Valida o conteúdo de um post |
| GET | `/api/media/proxy` | Proxy de imagens (cache de 1 h) |
| GET | `/api/websocket/status` | Estado do streaming do bot |

As respostas de erro seguem sempre o mesmo formato:

```json
{
  "error": {
    "message": "...",
    "code": "NOT_FOUND",
    "details": {},
    "timestamp": "2026-01-15T12:00:00+00:00"
  }
}
```

## 🧮 Cálculo de relevância

Cada post recebe um score de 0 a 100, combinando quatro sinais com escala
logarítmica (para que números muito grandes não dominem o resultado):

| Sinal | Peso |
|---|---|
| Favoritos | 35% |
| Boosts | 25% |
| Seguidores do autor | 25% |
| Respostas | 15% |

O score bruto (`log10` de cada métrica, ponderado) é normalizado com
`100 × (1 − e^(−raw / 2.5))`, o que faz o resultado se aproximar de 100 sem
nunca estourar.

## 🤖 Bot de menções

O bot escuta o streaming do Mastodon e responde a menções com o relatório da
hashtag citada, em imagem (com texto alternativo acessível) e texto.

```bash
@seubot #tercinema
```

Sem hashtag, o bot envia uma mensagem de ajuda; sem dados recentes, avisa que
não encontrou nada.

## 📁 Estrutura

```
src/hashpanel/
├── config.py            # Configuração validada (pydantic-settings)
├── constants.py         # Hashtags do dia, limites, códigos
├── errors.py            # Hierarquia de erros
├── database/            # Conexão, migrações e repositório
├── services/            # Mastodon, relevância, análise, coleta, imagens, bot
├── server/              # App FastAPI, middlewares e rotas
├── cli/                 # Interface de linha de comando
└── utils/               # Logger, timezone, validadores, links
```

## 🧪 Testes

```bash
pytest                       # suíte completa
pytest --cov=src/hashpanel   # com cobertura
```

## 📄 Licença

ISC

---

**Desenvolvido com ❤️ para a comunidade Mastodon**
