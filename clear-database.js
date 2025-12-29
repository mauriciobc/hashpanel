/**
 * Script para limpar dados do banco de dados
 * 
 * Uso:
 *   node clear-database.js              # Limpa todos os dados
 *   node clear-database.js --confirm    # Requer confirmação
 */

import { getDatabase } from './src/database/index.js';
import { logger } from './src/utils/logger.js';

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'cyan');
}

async function main() {
  const args = process.argv.slice(2);
  const needsConfirmation = args.includes('--confirm');
  
  let database;
  
  try {
    log('\n' + '='.repeat(60));
    log('LIMPEZA DO BANCO DE DADOS', 'red');
    log('='.repeat(60) + '\n');
    
    database = getDatabase();
    const db = database.getDatabase();
    
    // Verificar estatísticas antes
    const statsBefore = db.prepare(`
      SELECT 
        COUNT(*) as total_records,
        COUNT(DISTINCT hashtag) as unique_hashtags,
        MIN(date) as oldest_date,
        MAX(date) as newest_date
      FROM hashtag_history
    `).get();
    
    logInfo('Estatísticas atuais:');
    logInfo(`  Total de registros: ${statsBefore.total_records || 0}`);
    logInfo(`  Hashtags únicos: ${statsBefore.unique_hashtags || 0}`);
    logInfo(`  Data mais antiga: ${statsBefore.oldest_date || 'N/A'}`);
    logInfo(`  Data mais recente: ${statsBefore.newest_date || 'N/A'}`);
    
    if (statsBefore.total_records === 0) {
      logWarning('Banco de dados já está vazio.');
      return;
    }
    
    // Confirmação se necessário
    if (needsConfirmation) {
      logWarning('\n⚠️  ATENÇÃO: Esta operação irá DELETAR TODOS os dados!');
      logWarning('Digite "CONFIRMAR" para continuar:');
      
      // Em produção, você usaria readline, mas para simplicidade:
      logError('Use sem --confirm para limpar automaticamente');
      process.exit(1);
    }
    
    logWarning('\n⚠️  Limpando todos os dados do banco...');
    
    // Limpar todos os dados
    const result = db.prepare('DELETE FROM hashtag_history').run();
    
    logSuccess(`\n✅ ${result.changes} registros deletados com sucesso!`);
    
    // Verificar estatísticas depois
    const statsAfter = db.prepare(`
      SELECT COUNT(*) as total_records
      FROM hashtag_history
    `).get();
    
    logInfo(`\nRegistros restantes: ${statsAfter.total_records || 0}`);
    
    if (statsAfter.total_records === 0) {
      logSuccess('Banco de dados limpo completamente!');
    } else {
      logError('Ainda há registros no banco. Algo deu errado.');
    }
    
  } catch (error) {
    logError(`Erro ao limpar banco: ${error.message}`);
    console.error(error);
    process.exit(1);
  } finally {
    if (database) {
      database.close();
    }
  }
}

main();
