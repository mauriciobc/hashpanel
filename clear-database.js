/**
 * Script para limpar dados do banco de dados
 * 
 * Uso:
 *   node clear-database.js              # Requer confirmação (não executa)
 *   node clear-database.js --confirm    # Confirma e prossegue com a limpeza
 */

import { getDatabase } from './src/database/index.js';
import { logger } from './src/utils/logger.js';

async function main() {
  const args = process.argv.slice(2);
  const isConfirmed = args.includes('--confirm');
  
  let database;
  
  try {
    logger.info('\n' + '='.repeat(60));
    logger.error('LIMPEZA DO BANCO DE DADOS');
    logger.info('='.repeat(60) + '\n');
    
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
    
    logger.info('ℹ️  Estatísticas atuais:');
    logger.info(`  Total de registros: ${statsBefore.total_records || 0}`);
    logger.info(`  Hashtags únicos: ${statsBefore.unique_hashtags || 0}`);
    logger.info(`  Data mais antiga: ${statsBefore.oldest_date || 'N/A'}`);
    logger.info(`  Data mais recente: ${statsBefore.newest_date || 'N/A'}`);
    
    if (statsBefore.total_records === 0) {
      logger.warn('⚠️  Banco de dados já está vazio.');
      return;
    }
    
    // Confirmação se necessário
    if (!isConfirmed) {
      logger.warn('\n⚠️  ATENÇÃO: Esta operação irá DELETAR TODOS os dados!');
      logger.warn('Use --confirm para prosseguir com a limpeza.');
      logger.error('❌ Operação cancelada. Use --confirm para confirmar a deleção.');
      process.exit(1);
    }
    
    logger.warn('\n⚠️  Limpando todos os dados do banco...');
    
    // Limpar todos os dados
    const result = db.prepare('DELETE FROM hashtag_history').run();
    
    logger.info(`\n✅ ${result.changes} registros deletados com sucesso!`);
    
    // Verificar estatísticas depois
    const statsAfter = db.prepare(`
      SELECT COUNT(*) as total_records
      FROM hashtag_history
    `).get();
    
    logger.info(`\nRegistros restantes: ${statsAfter.total_records || 0}`);
    
    if (statsAfter.total_records === 0) {
      logger.info('✅ Banco de dados limpo completamente!');
    } else {
      logger.error('❌ Ainda há registros no banco. Algo deu errado.');
    }
    
  } catch (error) {
    logger.error(`❌ Erro ao limpar banco: ${error.message}`, error);
    process.exit(1);
  } finally {
    if (database) {
      database.close();
    }
  }
}

main();
