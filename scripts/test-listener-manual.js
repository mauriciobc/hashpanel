/**
 * Script para testar manualmente a lógica de resposta do HashtagListener
 * sem precisar enviar um post real no Mastodon.
 * 
 * Uso: node scripts/test-listener-manual.js
 */

import { hashtagListener } from '../src/services/hashtagListener.js';
import { logger } from '../src/utils/logger.js';

async function testListener() {
  console.log('--- Iniciando Teste Manual do Listener (Mention Mode) ---');

  try {
    // 1. Inicializar o listener (configura ID da conta)
    console.log('Passo 1: Inicializando serviço...');
    await hashtagListener.start();
    
    // Parar o WebSocket real para não interferir no teste
    hashtagListener.stop();

    console.log(`Bot username: @${hashtagListener.ownUsername}`);

    // 2. Teste 1: Mention com hashtag válida
    console.log('\n=== TESTE 1: Mention com hashtag válida ===');
    const mockNotification1 = {
      type: 'mention',
      status: {
        id: '111111111111111111',
        uri: 'https://mastodon.social/users/testuser/statuses/111111111111111111',
        url: 'https://mastodon.social/@testuser/111111111111111111',
        account: {
          id: '12345',
          username: 'testuser',
          acct: 'testuser',
          display_name: 'Test User',
          bot: false
        },
        content: `<p><span class="h-card"><a href="https://mastodon.social/@${hashtagListener.ownUsername}" class="u-url mention">@${hashtagListener.ownUsername}</a></span> Ei, me mostra dados da <a href="https://mastodon.social/tags/tercinema" class="mention hashtag">#<span>tercinema</span></a>!</p>`,
        visibility: 'direct',
        created_at: new Date().toISOString()
      }
    };

    console.log(`Simulando mention de @${mockNotification1.status.account.username} com #tercinema...`);
    await hashtagListener.handleMention(mockNotification1);

    // 3. Teste 2: Mention SEM hashtag (deve retornar mensagem de ajuda)
    console.log('\n=== TESTE 2: Mention SEM hashtag (mensagem de ajuda) ===');
    const mockNotification2 = {
      type: 'mention',
      status: {
        id: '222222222222222222',
        uri: 'https://mastodon.social/users/testuser/statuses/222222222222222222',
        url: 'https://mastodon.social/@testuser/222222222222222222',
        account: {
          id: '12345',
          username: 'testuser',
          acct: 'testuser',
          display_name: 'Test User',
          bot: false
        },
        content: `<p><span class="h-card"><a href="https://mastodon.social/@${hashtagListener.ownUsername}" class="u-url mention">@${hashtagListener.ownUsername}</a></span> Oi bot!</p>`,
        visibility: 'direct',
        created_at: new Date().toISOString()
      }
    };

    console.log(`Simulando mention de @${mockNotification2.status.account.username} SEM hashtag...`);
    await hashtagListener.handleMention(mockNotification2);

    // 4. Teste 3: Mention com múltiplas hashtags (deve usar a primeira)
    console.log('\n=== TESTE 3: Mention com múltiplas hashtags ===');
    const mockNotification3 = {
      type: 'mention',
      status: {
        id: '333333333333333333',
        uri: 'https://mastodon.social/users/testuser/statuses/333333333333333333',
        url: 'https://mastodon.social/@testuser/333333333333333333',
        account: {
          id: '12345',
          username: 'testuser',
          acct: 'testuser',
          display_name: 'Test User',
          bot: false
        },
        content: `<p><span class="h-card"><a href="https://mastodon.social/@${hashtagListener.ownUsername}" class="u-url mention">@${hashtagListener.ownUsername}</a></span> Compare <a href="https://mastodon.social/tags/tercinema" class="mention hashtag">#<span>tercinema</span></a> e <a href="https://mastodon.social/tags/sextaserie" class="mention hashtag">#<span>sextaserie</span></a></p>`,
        visibility: 'direct',
        created_at: new Date().toISOString()
      }
    };

    console.log(`Simulando mention de @${mockNotification3.status.account.username} com #tercinema e #sextaserie...`);
    await hashtagListener.handleMention(mockNotification3);

    console.log('\n--- Teste Concluído ---');
    console.log('✅ Verifique os logs acima para confirmar o comportamento esperado.');
    console.log('⚠️  Nota: Se configurado, respostas REAIS foram enviadas como Direct Messages!');
    
  } catch (error) {
    console.error('\n❌ Erro durante o teste:', error);
  } finally {
    process.exit(0);
  }
}

testListener();
