/**
 * Script de diagnóstico para coleta de dados
 * 
 * Verifica o formato dos dados retornados pela API do Mastodon
 * e identifica problemas na coleta
 * 
 * Uso:
 *   node diagnose-collection.js [hashtag]
 */

import { mastodonService } from '../src/services/mastodon.js';
import { historyCollector } from '../src/services/historyCollector.js';
import { HASHTAGS, getHashtagsForDay } from '../src/constants/index.js';
import { logger } from '../src/utils/logger.js';
import moment from 'moment-timezone';
import { appConfig as config } from '../src/config/index.js';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'cyan');
}

function logData(message) {
  log(`📊 ${message}`, 'blue');
}

/**
 * Analisa os dados retornados pela API
 */
async function analyzeAPIResponse(hashtag) {
  log('\n' + '='.repeat(60));
  log(`DIAGNÓSTICO: ${hashtag}`, 'cyan');
  log('='.repeat(60));
  
  try {
    logInfo('Buscando dados da API do Mastodon...');
    const history = await mastodonService.getHashtagUse(hashtag);
    
    if (!history) {
      logError('API retornou null ou undefined');
      return;
    }
    
    if (!Array.isArray(history)) {
      logError(`API não retornou um array. Tipo: ${typeof history}`);
      logData(`Conteúdo: ${JSON.stringify(history, null, 2)}`);
      return;
    }
    
    if (history.length === 0) {
      logWarning('API retornou array vazio');
      return;
    }
    
    logSuccess(`API retornou ${history.length} registros`);
    
    // Analisar estrutura do primeiro item
    const firstItem = history[0];
    logData('\nEstrutura do primeiro registro:');
    logData(JSON.stringify(firstItem, null, 2));
    
    // Verificar campos esperados
    logInfo('\nVerificando campos:');
    const hasDay = 'day' in firstItem;
    const hasUses = 'uses' in firstItem;
    const hasAccounts = 'accounts' in firstItem;
    
    logInfo(`  'day' presente: ${hasDay ? '✅' : '❌'}`);
    logInfo(`  'uses' presente: ${hasUses ? '✅' : '❌'}`);
    logInfo(`  'accounts' presente: ${hasAccounts ? '✅' : '❌'}`);
    
    if (!hasDay) {
      logError('Campo "day" não encontrado! Campos disponíveis:');
      logData(Object.keys(firstItem).join(', '));
    }
    
    // Mostrar todas as datas disponíveis (convertidas)
    logInfo('\nDatas disponíveis na API:');
    const dates = history.map(item => {
      const ts = parseInt(item.day);
      if (isNaN(ts)) {
        return { original: item.day, converted: item.day, uses: item.uses, accounts: item.accounts };
      }
      const converted = moment.unix(ts).tz(config.server.timezone).format('YYYY-MM-DD');
      return { original: item.day, converted, uses: item.uses, accounts: item.accounts };
    }).slice(0, 10);
    
    dates.forEach((date, idx) => {
      logInfo(`  ${idx + 1}. ${date.converted} (timestamp: ${date.original}) - Uses: ${date.uses}, Accounts: ${date.accounts}`);
    });
    if (history.length > 10) {
      logInfo(`  ... e mais ${history.length - 10} datas`);
    }
    
    // Verificar formato de data
    if (hasDay && firstItem.day) {
      logInfo('\nAnálise de formato de data:');
      const sampleDate = firstItem.day;
      logInfo(`  Formato retornado: "${sampleDate}"`);
      logInfo(`  Tamanho: ${sampleDate.length} caracteres`);
      
      // Tentar diferentes formatos
      const formats = [
        'YYYY-MM-DD',
        'YYYY/MM/DD',
        'DD-MM-YYYY',
        'DD/MM/YYYY',
        'YYYYMMDD'
      ];
      
      logInfo('  Tentando parsear com diferentes formatos:');
      formats.forEach(format => {
        const parsed = moment(sampleDate, format, true);
        if (parsed.isValid()) {
          logSuccess(`    ${format}: ✅ ${parsed.format('YYYY-MM-DD')}`);
        } else {
          logWarning(`    ${format}: ❌`);
        }
      });
    }
    
    // Verificar dados de hoje
    // A API do Mastodon retorna 'day' como Unix timestamp (segundos)
    // Precisamos converter para comparar com a data de hoje
    const today = moment().tz(config.server.timezone).format('YYYY-MM-DD');
    logInfo(`\nBuscando dados para hoje (${today}):`);
    
    // Helper para converter timestamp Unix para data string
    const convertDayToDateString = (day) => {
      const dayTimestamp = parseInt(day);
      if (isNaN(dayTimestamp)) {
        return day; // Já é string de data
      }
      // API usa UTC para agregação de dados
      return moment.unix(dayTimestamp).tz(config.server.timezone).format('YYYY-MM-DD');
    };
    
    // Buscar dados de hoje convertendo o timestamp
    let matchedTimestamp = null;
    const todayData = history.find(day => {
      const dayDate = convertDayToDateString(day.day);
      if (dayDate === today) {
        matchedTimestamp = day.day;
        return true;
      }
      return false;
    });
    
    if (todayData) {
      logSuccess('Dados de hoje encontrados!');
      logInfo(`  Timestamp original: ${matchedTimestamp}`);
      logInfo(`  Data formatada: ${convertDayToDateString(matchedTimestamp)}`);
      logData(JSON.stringify(todayData, null, 2));
    } else {
      logWarning('Dados de hoje NÃO encontrados na resposta da API');
      logInfo('Isso pode significar que a API ainda não agregou os dados de hoje.');
      
      // Mostrar datas mais próximas
      logInfo('\nDatas mais próximas de hoje:');
      // Criar now uma vez com timezone para reutilizar
      const now = moment().tz(config.server.timezone);
      
      const sortedDates = history
        .filter(item => item.day)
        .map(item => {
          // Detectar se é timestamp numérico
          const ts = parseInt(item.day);
          let dateMoment;
          
          if (!isNaN(ts)) {
            // É timestamp - verificar se é segundos ou milissegundos
            // Timestamps Unix geralmente são em segundos (10 dígitos ou menos)
            // Milissegundos têm 13 dígitos
            const timestampLength = ts.toString().length;
            if (timestampLength <= 10) {
              // Segundos - usar moment.unix()
              dateMoment = moment.unix(ts).tz(config.server.timezone);
            } else {
              // Milissegundos - usar moment() diretamente
              dateMoment = moment(ts).tz(config.server.timezone);
            }
          } else {
            // É string de data - tentar parsear com timezone
            dateMoment = moment.tz(item.day, ['YYYY-MM-DD', 'YYYY/MM/DD', 'DD-MM-YYYY'], config.server.timezone, true);
          }
          
          return {
            ...item,
            dateMoment
          };
        })
        .filter(item => item.dateMoment.isValid())
        .sort((a, b) => Math.abs(a.dateMoment.diff(now)) - Math.abs(b.dateMoment.diff(now)))
        .slice(0, 5);
      
      sortedDates.forEach((item, idx) => {
        const daysDiff = item.dateMoment.diff(now, 'days');
        const formattedDate = item.dateMoment.format('YYYY-MM-DD');
        logInfo(`  ${idx + 1}. ${formattedDate} (timestamp: ${item.day}, ${daysDiff > 0 ? '+' : ''}${daysDiff} dias)`);
      });
    }
    
    // Testar coleta real
    logInfo('\n' + '='.repeat(60));
    logInfo('Testando coleta real...');
    const collected = await historyCollector.collectHashtagData(hashtag, today);
    
    if (collected) {
      logSuccess('Coleta bem-sucedida!');
    } else {
      logWarning('Coleta não coletou dados (pode ser porque já existe ou não encontrou)');
    }
    
  } catch (error) {
    logError(`Erro ao analisar: ${error.message}`);
    console.error(error);
  }
}

/**
 * Função principal
 */
async function main() {
  const args = process.argv.slice(2);
  const hashtag = args[0];
  
  try {
    log('\n' + '='.repeat(60));
    log('DIAGNÓSTICO DE COLETA DE DADOS', 'cyan');
    log('='.repeat(60) + '\n');
    
    if (hashtag) {
      // Analisar hashtag específico
      await analyzeAPIResponse(hashtag);
    } else {
      // Analisar alguns hashtags
      const allHashtags = new Set();
      HASHTAGS.forEach(dayHashtags => {
        const hashtags = getHashtagsForDay(dayHashtags);
        hashtags.forEach(tag => allHashtags.add(tag));
      });
      
      const hashtagsArray = Array.from(allHashtags).slice(0, 3); // Primeiros 3
      
      logInfo(`Analisando ${hashtagsArray.length} hashtags de exemplo...\n`);
      
      for (const tag of hashtagsArray) {
        await analyzeAPIResponse(tag);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Delay entre requisições
      }
    }
    
    log('\n' + '='.repeat(60));
    logSuccess('Diagnóstico concluído!');
    log('='.repeat(60) + '\n');
    
  } catch (error) {
    logError(`Erro fatal: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

main();
