#!/bin/bash
# update-from-github.sh
# Script principal de atualização do HashPanel via GitHub.

set -e

# Configurações
CONTAINER_NAME="hashpanel"
GITHUB_REPO="mauriciobc/hashpanel"
GITHUB_BRANCH="main"
LOG_FILE="/tmp/hashpanel-update-$(date +%Y%m%d-%H%M%S).log"
HEALTH_URL="http://localhost:3000/health"
MAX_WAIT_HEALTH=60

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    local timestamp=$(date "+%Y-%m-%d %H:%M:%S")
    echo -e "${BLUE}[$timestamp]${NC} $1" | tee -a "$LOG_FILE"
}

success() {
    log "${GREEN}[OK]${NC} $1"
}

warning() {
    log "${YELLOW}[AVISO]${NC} $1"
}

error() {
    log "${RED}[ERRO]${NC} $1"
}

# 1. Verificações Iniciais
log "Iniciando processo de atualização do HashPanel..."

if ! command -v docker >/dev/null 2>&1; then
    error "Docker não encontrado no host. Abortando."
    exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    error "Container '${CONTAINER_NAME}' não está rodando. Inicie-o antes de atualizar."
    exit 1
fi

# 2. Executar atualização dentro do container
log "Executando script de atualização interna no container..."
# Captura a saída do script, a última linha deve ser o commit antigo
UPDATE_OUTPUT=$(docker exec "$CONTAINER_NAME" /app/scripts/update-inside-container.sh 2>&1)
EXIT_CODE=$?

echo "$UPDATE_OUTPUT" >> "$LOG_FILE"

if [ $EXIT_CODE -ne 0 ]; then
    error "Falha na atualização interna do container. Veja o log: $LOG_FILE"
    exit 1
fi

# Pega o commit antigo para rollback (última linha da saída)
OLD_COMMIT=$(echo "$UPDATE_OUTPUT" | tail -n 1)
log "Commit anterior salvo para possível rollback: $OLD_COMMIT"

# 3. Reinício Graceful do Processo Node.js
log "Reiniciando o processo Node.js dentro do container (Graceful)..."

# Encontrar o PID do servidor Node
NODE_PID=$(docker exec "$CONTAINER_NAME" pgrep -f 'node.*server-new.js' | head -n 1)

if [ -n "$NODE_PID" ]; then
    log "Enviando SIGTERM para o PID $NODE_PID..."
    docker exec "$CONTAINER_NAME" kill -TERM "$NODE_PID"
    
    # Aguardar o processo terminar (até 15s)
    for i in {1..15}; do
        if ! docker exec "$CONTAINER_NAME" ps -p "$NODE_PID" >/dev/null 2>&1; then
            success "Processo antigo encerrado."
            NODE_PID=""
            break
        fi
        sleep 1
    done
    
    if [ -n "$NODE_PID" ]; then
        warning "Processo não encerrou no tempo esperado. Forçando reinício do container..."
        docker restart "$CONTAINER_NAME"
    else
        # Iniciar novamente o servidor via entrypoint
        log "Iniciando novo processo do servidor..."
        docker exec -d "$CONTAINER_NAME" sh -c "/bin/sh /app/docker-entrypoint.sh npm run server"
    fi
else
    warning "Processo Node.js não encontrado. Reiniciando container para garantir estado limpo..."
    docker restart "$CONTAINER_NAME"
fi

# 4. Validação (Health Check)
log "Aguardando o servidor subir (Health Check: $HEALTH_URL)..."
HEALTHY=0
for ((i=1; i<=MAX_WAIT_HEALTH; i+=5)); do
    STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" || echo "000")
    if [ "$STATUS_CODE" = "200" ]; then
        HEALTHY=1
        break
    fi
    log "Aguardando... (Tentativa $((i/5 + 1)))"
    sleep 5
done

if [ "$HEALTHY" = "1" ]; then
    success "Atualização concluída com sucesso e servidor está saudável!"
else
    error "Health check falhou após ${MAX_WAIT_HEALTH}s. Iniciando ROLLBACK..."
    
    # 5. Rollback
    docker exec "$CONTAINER_NAME" sh -c "cd /app && git reset --hard $OLD_COMMIT"
    docker restart "$CONTAINER_NAME"
    
    # Verificar health check novamente após rollback
    sleep 10
    STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" || echo "000")
    if [ "$STATUS_CODE" = "200" ]; then
        warning "Rollback concluído. O sistema voltou para a versão anterior: $OLD_COMMIT"
    else
        error "CRÍTICO: Mesmo após o rollback, o sistema não está respondendo!"
    fi
    exit 1
fi
