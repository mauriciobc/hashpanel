/**
 * Script para criar dados de teste para histórico semanal
 * 
 * Cria dados simulados para demonstrar a funcionalidade de agregação semanal
 * 
 * Uso:
 *   node create-test-data.js
 */

import { getDatabase } from './src/database/index.js';
import { databaseService } from './src/services/databaseService.js';
import { getISOWeek } from './src/database/migrations.js';
import { HASHTAGS, getHashtagsForDay } from './src/constants/index.js';
import moment from 'moment-timezone';
import { appConfig as config } from './src/config/index.js';

// Cores para output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'cyan');
}

/**
 * Gera dados de teste para um período
 */
function generateTestData(hashtag, startDate, days) {
  const data = [];
  const currentDate = moment.tz(startDate, config.server.timezone);
  
  for (let i = 0; i < days; i++) {
    const dateStr = currentDate.format('YYYY-MM-DD');
    
    // Gera valores aleatórios mas realistas
    // Simula variação semanal (mais atividade no meio da semana)
    const dayOfWeek = currentDate.day();
    const baseUses = dayOfWeek >= 1 && dayOfWeek <= 5 ? 50 : 30; // Mais atividade em dias úteis
    const uses = baseUses + Math.floor(Math.random() * 100);
    const accounts = Math.floor(uses * (0.3 + Math.random() * 0.4)); // 30-70% de accounts
    
    data.push({
      hashtag,
      date: dateStr,
      uses,
      accounts
    });
    
    currentDate.add(1, 'day');
  }
  
  return data;
}

/**
 * Função principal
 */
async function main() {
  let database;
  
  try {
    log('\n' + '='.repeat(60));
    log('CRIAÇÃO DE DADOS DE TESTE PARA HISTÓRICO SEMANAL', 'cyan');
    log('='.repeat(60) + '\n');
    
    // Inicializar banco
    database = getDatabase();
    
    // Obter todos os hashtags
    const allHashtags = new Set();
    HASHTAGS.forEach(dayHashtags => {
      const hashtags = getHashtagsForDay(dayHashtags);
      hashtags.forEach(tag => allHashtags.add(tag));
    });
    
    const hashtagsArray = Array.from(allHashtags);
    logInfo(`Criando dados de teste para ${hashtagsArray.length} hashtags`);
    
    // Criar dados para os últimos 30 dias (para ter várias semanas)
    const today = moment().tz(config.server.timezone);
    const startDate = today.clone().subtract(30, 'days');
    
    logInfo(`Período: ${startDate.format('YYYY-MM-DD')} até ${today.format('YYYY-MM-DD')}`);
    logInfo(`Isso criará dados para aproximadamente ${Math.ceil(30 / 7)} semanas\n`);
    
    let totalInserted = 0;
    let totalSkipped = 0;
    
    for (const hashtag of hashtagsArray) {
      const testData = generateTestData(hashtag, startDate.format('YYYY-MM-DD'), 30);
      
      for (const data of testData) {
        try {
          const inserted = databaseService.saveDailyHashtagData(
            data.hashtag,
            data.date,
            { uses: data.uses, accounts: data.accounts }
          );
          
          if (inserted) {
            totalInserted++;
          } else {
            totalSkipped++;
          }
        } catch (error) {
          console.error(`Erro ao inserir dados para ${data.hashtag} em ${data.date}:`, error.message);
        }
      }
      
      logSuccess(`Dados criados para ${hashtag}`);
    }
    
    log('\n' + '='.repeat(60));
    logSuccess('Dados de teste criados com sucesso!');
    logInfo(`  Total de registros inseridos: ${totalInserted}`);
    logInfo(`  Registros já existentes (ignorados): ${totalSkipped}`);
    log('\n' + '='.repeat(60));
    logInfo('Próximos passos:');
    logInfo('  1. Execute: node test-weekly-history.js');
    logInfo('  2. Ou teste os endpoints da API diretamente');
    logInfo('  3. Verifique o dashboard em http://localhost:3000');
    
  } catch (error) {
    console.error('Erro fatal:', error);
    process.exit(1);
  } finally {
    if (database) {
      database.close();
    }
  }
}

// Executar
main();
