import { mastodonService } from './mastodon.js';
import { imageGenerator } from './imageGenerator.js';
import { hashtagService } from './hashtagService.js';
import { logger } from '../utils/logger.js';
import { appConfig as config } from '../config/index.js';

/**
 * Listener para hashtags do Mastodon que responde automaticamente com um relatório
 */
export class HashtagListener {
  constructor() {
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000; // 5 segundos
    this.ownAccountId = null;
    this.ownUsername = null;
  }

  /**
   * Descobre a URL base do streaming via API da instância (urls.streaming_api).
   * Instâncias como mastodon.social usam host separado (streaming.mastodon.social);
   * WebSocket não segue redirect 301, então precisamos conectar direto no host correto.
   * @returns {Promise<string|null>} Base WebSocket (ex: wss://streaming.mastodon.social) ou null para fallback
   */
  async getStreamingBaseUrl() {
    const base = config.mastodon.url.replace(/\/api\/v1\/?$/, '').replace(/\/$/, '');
    const instanceUrl = `${base}/api/v1/instance`;
    try {
      const res = await fetch(instanceUrl, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return null;
      const data = await res.json();
      const url =
        data?.urls?.streaming_api ??
        data?.configuration?.urls?.streaming ??
        null;
      if (url && typeof url === 'string') {
        const normalized = url.replace(/\/$/, '');
        logger.debug('URL de streaming descoberta', { streamingBase: normalized });
        return normalized;
      }
      return null;
    } catch (error) {
      logger.warn('Falha ao obter streaming_api da instância; usando fallback', {
        instanceUrl,
        error: error?.message,
      });
      return null;
    }
  }

  /**
   * Inicia o listener para mentions do bot
   */
  async start() {
    try {
      logger.info('Iniciando listener de mentions do bot');

      // Verificar se as configurações estão disponíveis antes de fazer a requisição
      const token = config.mastodon.accessToken;
      const apiUrl = config.mastodon.url;
      
      logger.debug('Verificando configurações do Mastodon antes de conectar', {
        hasToken: !!token,
        tokenLength: token?.length || 0,
        tokenPreview: token ? `${token.substring(0, 8)}...` : 'não definido',
        apiUrl,
        environment: config.server.environment
      });

      if (!token || token.length === 0) {
        throw new Error('ACCESS_TOKEN não está definido ou está vazio. Verifique as variáveis de ambiente no Docker.');
      }

      if (!apiUrl || apiUrl.length === 0) {
        throw new Error('MASTODON_URL não está definido. Verifique as variáveis de ambiente no Docker.');
      }

      // Obter o ID da própria conta para evitar responder a si mesmo
      const credentials = await mastodonService.makeAPIRequest('accounts/verify_credentials');
      
      // Validar se as credenciais foram retornadas corretamente
      if (!credentials) {
        throw new Error('Resposta de verify_credentials está vazia ou undefined');
      }
      
      // Log da resposta completa para debug (sem dados sensíveis)
      logger.debug('Resposta de verify_credentials recebida', {
        hasId: !!credentials.id,
        hasUsername: !!credentials.username,
        hasAcct: !!credentials.acct,
        keys: Object.keys(credentials).filter(k => !['note', 'avatar', 'header', 'source'].includes(k))
      });
      
      // Verificar campos obrigatórios
      if (!credentials.id) {
        logger.error('Campo "id" não encontrado na resposta de verify_credentials', {
          availableKeys: Object.keys(credentials),
          responseSample: JSON.stringify(credentials).substring(0, 200)
        });
        throw new Error('Campo "id" não encontrado na resposta de verify_credentials. Verifique se o token de acesso é válido.');
      }
      
      // Usar 'acct' como fallback se 'username' não estiver disponível
      const username = credentials.username || credentials.acct || credentials.id?.toString();
      if (!username) {
        logger.error('Nem "username" nem "acct" encontrados na resposta de verify_credentials', {
          availableKeys: Object.keys(credentials)
        });
        throw new Error('Campo "username" ou "acct" não encontrado na resposta de verify_credentials');
      }
      
      this.ownAccountId = credentials.id;
      this.ownUsername = username.replace(/^@/, ''); // Remove @ se presente
      logger.info(`Bot identificado como @${this.ownUsername} (ID: ${this.ownAccountId})`);

      await this.connect();
    } catch (error) {
      logger.error('Falha ao iniciar HashtagListener', {
        error: error.message,
        stack: error.stack,
        name: error.name
      });
      this.scheduleReconnect();
    }
  }

  /**
   * Estabelece conexão WebSocket para receber notificações.
   * Usa streaming_api da instância quando disponível (evita 301 → 1006 em mastodon.social).
   */
  async connect() {
    if (!global.WebSocket && !global.Websocket) {
      logger.error('WebSocket nativo não disponível. Use Node.js 21+ ou ative com --experimental-websocket no Node.js 18/20.');
      return;
    }

    // Verificar se temos credenciais válidas antes de conectar
    if (!this.ownAccountId || !this.ownUsername) {
      logger.error('Não é possível conectar WebSocket: credenciais do bot não foram obtidas. Verifique o token de acesso.');
      return;
    }

    let baseUrl =
      (await this.getStreamingBaseUrl()) ||
      config.mastodon.url
        .replace(/^http/, 'ws')
        .replace(/\/api\/v1\/?$/, '')
        .replace(/\/$/, '');
    if (!baseUrl.startsWith('ws')) {
      baseUrl = baseUrl.replace(/^http/, 'ws');
    }
    
    // Construir URL de forma segura, verificando se o token existe e é válido
    const token = config.mastodon.accessToken;
    const hasValidToken = token && typeof token === 'string' && token.length > 0;
    
    if (!hasValidToken) {
      logger.error('Não é possível conectar WebSocket: token de acesso não encontrado ou inválido');
      return;
    }
    
    const wsUrl = `${baseUrl}/api/v1/streaming?stream=user&access_token=${token}`;
    
    // Construir versão redacted de forma segura
    const wsUrlRedacted = wsUrl.replace(token, 'REDACTED');

    logger.debug(`Conectando ao WebSocket: ${wsUrlRedacted}`, {
      baseUrl,
      hasToken: hasValidToken,
      tokenLength: token?.length || 0
    });

    const WS = global.WebSocket || global.Websocket;
    this.ws = new WS(wsUrl);
    this._wsUrlRedacted = wsUrlRedacted;

    this.ws.onopen = () => {
      logger.info('Conectado ao streaming de notificações do bot');
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Log de debug para ver qualquer evento que chegue
        logger.debug(`Evento recebido no streaming: ${data.event}`, { 
          stream: 'user'
        });

        // Processar notificações (mentions)
        if (data.event === 'notification') {
          const notification = JSON.parse(data.payload);
          if (notification.type === 'mention') {
            await this.handleMention(notification);
          }
        }
      } catch (error) {
        logger.error('Erro ao processar mensagem do streaming', error);
      }
    };

    this.ws.onerror = (event) => {
      this._lastErrorOccurred = true;
      const readyState = this.ws?.readyState ?? -1;
      const states = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
      
      // Extrair mais informações do erro se disponível
      const errorMessage = event.message || event.error?.message || 'Erro desconhecido';
      const errorCode = event.code || event.error?.code;
      
      logger.error('Erro no WebSocket de notificações', {
        url: this._wsUrlRedacted,
        readyState: states[readyState] ?? readyState,
        eventType: event?.type,
        errorMessage,
        errorCode,
        hint: 'Códigos comuns: 1006 (conexão fechada anormalmente), 1002 (erro de protocolo), 1003 (dados inválidos). Verifique se o token é válido e se a instância suporta streaming WebSocket.',
      });
    };

    this.ws.onclose = (event) => {
      const reason = event.reason?.trim() || null;
      const afterError = this._lastErrorOccurred ? ' (após onerror)' : '';
      this._lastErrorOccurred = false;
      
      // Interpretar códigos de fechamento comuns
      let codeExplanation = '';
      switch (event.code) {
        case 1000:
          codeExplanation = ' (fechamento normal)';
          break;
        case 1001:
          codeExplanation = ' (endpoint indo embora)';
          break;
        case 1002:
          codeExplanation = ' (erro de protocolo)';
          break;
        case 1003:
          codeExplanation = ' (tipo de dado não suportado)';
          break;
        case 1006:
          codeExplanation = ' (conexão fechada anormalmente - possível problema de autenticação ou rede)';
          break;
        case 1008:
          codeExplanation = ' (violação de política)';
          break;
        case 1011:
          codeExplanation = ' (erro interno do servidor)';
          break;
        default:
          codeExplanation = ` (código desconhecido: ${event.code})`;
      }
      
      logger.warn(`WebSocket fechado (Código: ${event.code}${codeExplanation}${reason ? `, reason: ${reason}` : ''})${afterError}. Tentando reconectar...`, {
        code: event.code,
        reason: reason || undefined,
        url: this._wsUrlRedacted,
        wasClean: event.wasClean,
      });
      this.scheduleReconnect();
    };
  }

  /**
   * Extrai hashtags do conteúdo de um toot
   * @param {string} content - Conteúdo HTML do toot
   * @returns {string[]} Array de hashtags (sem o #)
   */
  extractHashtags(content) {
    const hashtags = [];
    
    // Primeiro, tenta extrair de elementos <span> dentro de links .hashtag (formato Mastodon)
    const spanRegex = /<a[^>]*class="[^"]*hashtag[^"]*"[^>]*>#<span>([^<]+)<\/span><\/a>/gi;
    let match;
    
    while ((match = spanRegex.exec(content)) !== null) {
      const hashtag = match[1].toLowerCase();
      if (hashtag !== 'hashpanel' && hashtag !== 'bot') {
        hashtags.push(hashtag);
      }
    }
    
    // Se encontrou hashtags no formato Mastodon, retorna elas
    if (hashtags.length > 0) {
      return hashtags;
    }
    
    // Caso contrário, tenta regex simples no texto
    const textContent = content.replace(/<[^>]*>/g, ' ');
    const hashtagRegex = /#([\w\u00C0-\u024F\u1E00-\u1EFF]+)/gi;
    
    while ((match = hashtagRegex.exec(textContent)) !== null) {
      const hashtag = match[1].toLowerCase();
      if (hashtag !== 'hashpanel' && hashtag !== 'bot') {
        hashtags.push(hashtag);
      }
    }
    
    return hashtags;
  }

  /**
   * Processa uma mention (notificação de menção ao bot)
   */
  async handleMention(notification) {
    const status = notification.status;
    
    // Log de cada mention recebida
    logger.debug(`Analisando mention recebida: ${status.id}`, {
      user: status.account.username,
      userId: status.account.id,
      ownId: this.ownAccountId,
      bot: status.account.bot
    });

    // 1. Filtros básicos: evitar bots, ignorar a si mesmo
    if (status.account.id === this.ownAccountId) {
      logger.debug(`Mention ${status.id} ignorada: é do próprio bot`);
      return;
    }
    
    if (status.account.bot) {
      logger.debug(`Mention ${status.id} ignorada: é de um bot`);
      return;
    }

    logger.info(`Nova mention recebida de @${status.account.username}`, { 
      id: status.id
    });

    try {
      // 2. Extrair hashtags do conteúdo
      const hashtags = this.extractHashtags(status.content);
      
      if (hashtags.length === 0) {
        // Sem hashtag: enviar mensagem de ajuda
        const helpText = `@${status.account.username} Olá! 👋\n\nPara usar o bot, mencione-me junto com uma hashtag. Exemplo:\n@${this.ownUsername} #tercinema\n\nVou gerar um relatório com as estatísticas dessa hashtag! 📊`;
        
        await mastodonService.createToot(helpText, {
          in_reply_to_id: status.id,
          visibility: status.visibility
        });
        
        logger.info(`Mensagem de ajuda enviada para ${status.id}`);
        return;
      }

      // 3. Usar a primeira hashtag válida
      const targetHashtag = hashtags[0];
      logger.info(`Hashtag extraída da mention: #${targetHashtag}`);
      
      // 4. Gerar análise da hashtag
      const analysis = await hashtagService.analyzeHashtag(targetHashtag, { maxPages: 1 });
      
      const todayCount = analysis.getTodayCount();
      
      // Se não houver dados suficientes
      if (todayCount === 0) {
        const noDataText = `@${status.account.username} Não encontrei dados recentes para #${targetHashtag}. 😔\n\nTalvez essa hashtag não tenha sido usada hoje, ou não há posts públicos disponíveis.`;
        
        await mastodonService.createToot(noDataText, {
          in_reply_to_id: status.id,
          visibility: status.visibility
        });
        
        logger.info(`Resposta de sem dados enviada para ${status.id}`);
        return;
      }
      
      // 5. Preparar dados para a imagem
      const stats = {
        hashtag: targetHashtag,
        summary: {
          tootCount: todayCount,
          uniqueUsers: analysis.getUniqueUserCount(),
          weeklyTotal: analysis.getWeeklyTotal()
        }
      };

      // 6. Gerar imagem do dashboard com descrição acessível
      const { imageBuffer, altText } = await imageGenerator.generateDashboardImage(stats);

      // 7. Upload da mídia com descrição ALT acessível
      const media = await mastodonService.uploadMedia(
        imageBuffer, 
        altText
      );

      // 8. Enviar resposta com imagem
      const replyText = `@${status.account.username} Aqui está o resumo para #${targetHashtag}! 📊\n\n#hashpanel`;
      
      await mastodonService.createToot(replyText, {
        in_reply_to_id: status.id,
        media_ids: [media.id],
        visibility: status.visibility
      });

      logger.info(`Resposta com relatório enviada para ${status.id} (hashtag: #${targetHashtag})`);
    } catch (error) {
      logger.error(`Erro ao responder mention ${status.id}`, error);
      
      // Tentar enviar mensagem de erro ao usuário
      try {
        const errorText = `@${status.account.username} Desculpe, ocorreu um erro ao processar sua solicitação. 😔\n\nTente novamente mais tarde!`;
        
        await mastodonService.createToot(errorText, {
          in_reply_to_id: status.id,
          visibility: status.visibility
        });
      } catch (replyError) {
        logger.error(`Erro ao enviar mensagem de erro para ${status.id}`, replyError);
      }
    }
  }

  /**
   * Agenda uma reconexão com backoff simples
   * Chama start() em vez de connect() para garantir que as credenciais sejam obtidas
   */
  scheduleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * this.reconnectAttempts;
      logger.info(`Agendando reconexão em ${delay/1000}s (Tentativa ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      setTimeout(() => {
        // Chama start() para garantir que ownAccountId e ownUsername sejam definidos
        // start() já chama scheduleReconnect() em caso de erro, então não precisamos tratar aqui
        this.start().catch(error => {
          logger.error('Erro na reconexão', error);
          // start() já chama scheduleReconnect() em caso de erro no bloco catch
        });
      }, delay);
    } else {
      logger.error('Número máximo de tentativas de reconexão atingido.');
    }
  }

  /**
   * Fecha a conexão
   */
  stop() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      logger.info('Listener de mentions parado');
    }
  }
}

export const hashtagListener = new HashtagListener();
