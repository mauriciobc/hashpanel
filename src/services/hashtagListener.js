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

      // Obter o ID da própria conta para evitar responder a si mesmo
      const credentials = await mastodonService.makeAPIRequest('accounts/verify_credentials');
      this.ownAccountId = credentials.id;
      this.ownUsername = credentials.username;
      logger.info(`Bot identificado como @${credentials.username} (ID: ${this.ownAccountId})`);

      await this.connect();
    } catch (error) {
      logger.error('Falha ao iniciar HashtagListener', error);
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
    const wsUrl = hasValidToken
      ? `${baseUrl}/api/v1/streaming?stream=user&access_token=${token}`
      : `${baseUrl}/api/v1/streaming?stream=user`;
    
    // Construir versão redacted de forma segura
    const wsUrlRedacted = hasValidToken
      ? wsUrl.replace(token, 'REDACTED')
      : wsUrl; // Quando não há token, usar a URL original (sem parâmetro access_token)

    logger.debug(`Conectando ao WebSocket: ${wsUrlRedacted}`);

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
      logger.error('Erro no WebSocket de notificações', {
        url: this._wsUrlRedacted,
        readyState: states[readyState] ?? readyState,
        eventType: event?.type,
        hint: 'Detalhes geralmente vêm em onclose (código e reason). Verifique token, SSL e se a instância usa streaming em outro host.',
      });
    };

    this.ws.onclose = (event) => {
      const reason = event.reason?.trim() || null;
      const afterError = this._lastErrorOccurred ? ' (após onerror)' : '';
      this._lastErrorOccurred = false;
      logger.warn(`WebSocket fechado (Código: ${event.code}${reason ? `, reason: ${reason}` : ''})${afterError}. Tentando reconectar...`, {
        code: event.code,
        reason: reason || undefined,
        url: this._wsUrlRedacted,
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
