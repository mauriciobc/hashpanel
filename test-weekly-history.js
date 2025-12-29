/**
 * Script de teste para funcionalidade de histórico semanal
 * 
 * Este script testa:
 * 1. Verificação de dados no banco
 * 2. Coleta de dados de teste (se necessário)
 * 3. Teste dos endpoints da API
 * 4. Validação da agregação semanal
 * 
 * Uso:
 *   node test-weekly-history.js
 *   node test-weekly-history.js --collect  # Força coleta de dados
 */

import { getDatabase } from './src/database/index.js';
import { databaseService } from './src/services/databaseService.js';
import { historyCollector } from './src/services/historyCollector.js';
import { HASHTAGS, getHashtagsForDay } from './src/constants/index.js';
import { logger } from './src/utils/logger.js';
import moment from 'moment-timezone';
import { appConfig as config } from './src/config/index.js';

// Cores para output no terminal
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'bright');
  console.log('='.repeat(60));
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'cyan');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

/**
 * Obtém todos os hashtags únicos de HASHTAGS
 * @returns {string[]} Array de hashtags únicos
 */
function getAllUniqueHashtags() {
  const allHashtags = new Set();
  HASHTAGS.forEach(dayHashtags => {
    const hashtags = getHashtagsForDay(dayHashtags);
    hashtags.forEach(tag => allHashtags.add(tag));
  });
  return Array.from(allHashtags);
}

/**
 * Verifica estatísticas do banco de dados
 */
function checkDatabaseStats() {
  logSection('1. VERIFICAÇÃO DO BANCO DE DADOS');
  
  try {
    const stats = getDatabase().getStats();
    
    logInfo(`Caminho do banco: ${stats.path}`);
    logInfo(`Total de registros: ${stats.total_records || 0}`);
    logInfo(`Hashtags únicos: ${stats.unique_hashtags || 0}`);
    logInfo(`Data mais antiga: ${stats.oldest_date || 'N/A'}`);
    logInfo(`Data mais recente: ${stats.newest_date || 'N/A'}`);
    
    if (stats.total_records === 0) {
      logWarning('Banco de dados está vazio. Será necessário coletar dados.');
      return false;
    }
    
    logSuccess('Banco de dados contém dados');
    return true;
  } catch (error) {
    logError(`Erro ao verificar banco: ${error.message}`);
    throw error;
  }
}

/**
 * Verifica dados por hashtag
 */
function checkHashtagData() {
  logSection('2. VERIFICAÇÃO DE DADOS POR HASHTAG');
  
  try {
    // Obter todos os hashtags únicos
    const hashtagsArray = getAllUniqueHashtags();
    logInfo(`Total de hashtags configurados: ${hashtagsArray.length}`);
    
    const hashtagStats = [];
    for (const hashtag of hashtagsArray.slice(0, 5)) { // Limitar a 5 para não demorar muito
      const dateRange = databaseService.getDateRange(hashtag);
      const latestDate = databaseService.getLatestCollectionDate(hashtag);
      
      hashtagStats.push({
        hashtag,
        hasData: dateRange.minDate !== null,
        minDate: dateRange.minDate,
        maxDate: dateRange.maxDate,
        latestDate
      });
    }
    
    console.log('\nDados dos primeiros 5 hashtags:');
    hashtagStats.forEach(stat => {
      if (stat.hasData) {
        logSuccess(`${stat.hashtag}: ${stat.minDate} até ${stat.maxDate} (última: ${stat.latestDate})`);
      } else {
        logWarning(`${stat.hashtag}: Sem dados`);
      }
    });
    
    return hashtagStats.some(s => s.hasData);
  } catch (error) {
    logError(`Erro ao verificar dados por hashtag: ${error.message}`);
    throw error;
  }
}

/**
 * Coleta dados de teste
 */
async function collectTestData(force = false) {
  logSection('3. COLETA DE DADOS DE TESTE');
  
  try {
    // Verificar se já temos dados suficientes
    if (!force) {
      const stats = getDatabase().getStats();
      if (stats.total_records > 0) {
        logInfo('Dados já existem no banco. Use --collect para forçar nova coleta.');
        return true;
      }
    }
    
    logInfo('Coletando dados para os últimos 7 dias...');
    
    const today = moment().tz(config.server.timezone);
    const startDate = today.clone().subtract(7, 'days').format('YYYY-MM-DD');
    const endDate = today.format('YYYY-MM-DD');
    
    logInfo(`Período: ${startDate} até ${endDate}`);
    
    const summary = await historyCollector.collectDateRange(startDate, endDate);
    
    logSuccess(`Coleta concluída!`);
    logInfo(`  Total de dias: ${summary.totalDays}`);
    logInfo(`  Registros coletados: ${summary.totalCollected}`);
    logInfo(`  Registros ignorados: ${summary.totalSkipped}`);
    logInfo(`  Erros: ${summary.totalErrors}`);
    
    return summary.totalErrors === 0;
  } catch (error) {
    logError(`Erro na coleta: ${error.message}`);
    throw error;
  }
}

/**
 * Testa agregação semanal
 */
function testWeeklyAggregation() {
  logSection('4. TESTE DE AGREGAÇÃO SEMANAL');
  
  try {
    const currentYear = new Date().getFullYear();
    const hashtagsArray = getAllUniqueHashtags();
    
    if (hashtagsArray.length === 0) {
      logError('Nenhum hashtag configurado para teste.');
      return false;
    }
    
    const testHashtag = hashtagsArray[0];
    
    logInfo(`Testando agregação semanal para: ${testHashtag} (ano ${currentYear})`);
    
    const result = databaseService.aggregateWeeklyData(testHashtag, currentYear);
    
    if (result.weeklyData.length === 0) {
      logWarning(`Nenhum dado semanal encontrado para ${testHashtag} em ${currentYear}`);
      logInfo('Isso é normal se não houver dados coletados para este ano.');
      return false;
    }
    
    logSuccess(`Encontradas ${result.weeklyData.length} semanas de dados`);
    logInfo(`\nResumo:`);
    logInfo(`  Total de semanas: ${result.summary.totalWeeks}`);
    logInfo(`  Total de uses: ${result.summary.totalUses}`);
    logInfo(`  Total de accounts: ${result.summary.totalAccounts}`);
    logInfo(`  Média semanal: ${result.summary.averageWeekly}`);
    
    if (result.summary.peakWeek) {
      logInfo(`\nSemana de pico:`);
      logInfo(`  Semana ${result.summary.peakWeek.weekNumber}: ${result.summary.peakWeek.weekStart} até ${result.summary.peakWeek.weekEnd}`);
      logInfo(`  Uses: ${result.summary.peakWeek.totalUses}`);
      logInfo(`  Accounts: ${result.summary.peakWeek.totalAccounts}`);
    }
    
    // Mostrar primeiras 3 semanas como exemplo
    console.log('\nPrimeiras 3 semanas:');
    result.weeklyData.slice(0, 3).forEach(week => {
      logInfo(`  Semana ${week.weekNumber}: ${week.weekStart} - ${week.weekEnd}`);
      logInfo(`    Uses: ${week.totalUses}, Accounts: ${week.totalAccounts}, Média diária: ${week.dailyAverage}`);
    });
    
    return true;
  } catch (error) {
    logError(`Erro no teste de agregação: ${error.message}`);
    throw error;
  }
}

/**
 * Testa endpoint da API (se servidor estiver rodando)
 */
async function testAPIEndpoints() {
  logSection('5. TESTE DOS ENDPOINTS DA API');
  
  try {
    const port = config.server.port || 3000;
    const baseUrl = `http://localhost:${port}`;
    
    logInfo(`Testando endpoints em: ${baseUrl}`);
    
    // Teste 1: Histórico semanal de todos os hashtags
    logInfo('\nTestando: GET /api/hashtag/history/weekly');
    try {
      const response = await fetch(`${baseUrl}/api/hashtag/history/weekly?year=${new Date().getFullYear()}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      logSuccess('Endpoint funcionando!');
      logInfo(`  Ano: ${data.year}`);
      logInfo(`  Total de hashtags: ${data.summary.totalHashtags}`);
      logInfo(`  Hashtags: ${data.summary.hashtags.slice(0, 5).join(', ')}${data.summary.hashtags.length > 5 ? '...' : ''}`);
    } catch (error) {
      if (error.code === 'ECONNREFUSED' || error.cause?.code === 'ECONNREFUSED') {
        logWarning('Servidor não está rodando. Inicie com: npm run server');
        return false;
      } else {
        logError(`Erro no endpoint: ${error.message}`);
        return false;
      }
    }
    
    // Teste 2: Histórico semanal de um hashtag específico
    const hashtagsArray = getAllUniqueHashtags();
    
    if (hashtagsArray.length === 0) {
      logError('Nenhum hashtag configurado para teste.');
      return false;
    }
    
    const testHashtag = hashtagsArray[0];
    
    logInfo(`\nTestando: GET /api/hashtag/${testHashtag}/history/weekly`);
    try {
      const response = await fetch(`${baseUrl}/api/hashtag/${testHashtag}/history/weekly?year=${new Date().getFullYear()}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      logSuccess('Endpoint funcionando!');
      logInfo(`  Hashtag: ${data.hashtag}`);
      logInfo(`  Ano: ${data.year}`);
      logInfo(`  Total de semanas: ${data.summary.totalWeeks}`);
      logInfo(`  Total de uses: ${data.summary.totalUses}`);
      
      if (data.weeklyData.length > 0) {
        logInfo(`\nPrimeira semana: Semana ${data.weeklyData[0].weekNumber} (${data.weeklyData[0].weekStart} - ${data.weeklyData[0].weekEnd})`);
      }
    } catch (error) {
      if (error.code === 'ECONNREFUSED' || error.cause?.code === 'ECONNREFUSED') {
        logWarning('Servidor não está rodando.');
      } else {
        logError(`Erro no endpoint: ${error.message}`);
      }
      return false;
    }
    
    return true;
  } catch (error) {
    logError(`Erro ao testar endpoints: ${error.message}`);
    return false;
  }
}

/**
 * Função principal
 */
async function main() {
  let database;
  const args = process.argv.slice(2);
  const shouldCollect = args.includes('--collect');
  
  try {
    log('\n' + '='.repeat(60));
    log('TESTE DE HISTÓRICO SEMANAL', 'bright');
    log('='.repeat(60) + '\n');
    
    // Inicializar banco
    database = getDatabase();
    
    // 1. Verificar banco
    const hasData = checkDatabaseStats();
    
    // 2. Verificar dados por hashtag
    const hasHashtagData = checkHashtagData();
    
    // 3. Coletar dados se necessário
    if (!hasData || shouldCollect) {
      await collectTestData(shouldCollect);
    }
    
    // 4. Testar agregação semanal
    testWeeklyAggregation();
    
    // 5. Testar endpoints da API
    await testAPIEndpoints();
    
    logSection('RESUMO');
    logSuccess('Testes concluídos!');
    logInfo('\nPróximos passos:');
    logInfo('  1. Verifique o dashboard em http://localhost:3000');
    logInfo('  2. Navegue até a seção de histórico semanal');
    logInfo('  3. Teste diferentes anos e hashtags');
    logInfo('  4. Para coletar mais dados: npm run collect:history');
    logInfo('  5. Para coletar um período específico: node src/cli/collectHistory.js --range 2024-01-01 2024-01-31');
    
  } catch (error) {
    logError(`Erro fatal: ${error.message}`);
    console.error(error);
    process.exit(1);
  } finally {
    if (database) {
      database.close();
    }
  }
}

// Executar
main();
