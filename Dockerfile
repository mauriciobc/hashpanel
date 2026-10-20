# ============================================
# Stage 1: Builder
# ============================================
FROM python:3.13-slim AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependências de sistema necessárias para compilar wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Instala o pacote e suas dependências
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --prefix=/install .

# ============================================
# Stage 2: Runtime
# ============================================
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=3000 \
    NODE_ENV=production

# curl: healthcheck | cron: agendador | fonts-dejavu: renderização das imagens
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    cron \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /install /usr/local

# Código-fonte e assets
COPY . .

# As fontes da imagem do relatório vêm junto do projeto
COPY assets/fonts ./assets/fonts

RUN chmod +x /app/docker-entrypoint.sh \
    && mkdir -p logs data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=15s --start-period=60s --retries=5 \
  CMD curl -f http://localhost:3000/health || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["hashpanel-server"]
