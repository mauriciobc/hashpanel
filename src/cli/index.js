import { logger, loggers } from '../utils/logger.js';
import { HASHTAGS } from '../constants/index.js';
import { appConfig as config } from '../config/index.js';
import { ConfigurationError, BusinessError } from '../errors/index.js';
import { HashtagService } from '../services/hashtagService.js';
import { TootService } from '../services/tootService.js';

export class CLIApplication {
  constructor() {
    this.hashtagService = new HashtagService();
    this.tootService = new TootService();
    this.isRunning = false;
  }

  /**
   * Main CLI execution method
   */
  async run(options = {}) {
    if (this.isRunning) {
      throw new BusinessError('CLI application is already running');
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      logger.info('Starting Hashbot CLI application', { options });
      
      // Validate configuration
      this.validateConfiguration();
      
      // Get the daily hashtag
      const dailyHashtag = this.getDailyHashtag(options.date);
      logger.info(`Processing daily hashtag: ${dailyHashtag}`);
      
      // Analyze hashtag usage
      const analysis = await this.hashtagService.analyzeHashtag(dailyHashtag);
      
      // Check if there are today's toots
      if (!analysis.hasTodayToots()) {
        console.log('Nenhum post encontrado para hoje. Encerrando.');
        logger.info('No toots found for today', { hashtag: dailyHashtag });
        return;
      }
      
      // Generate summary
      const summary = await this.tootService.generateSummary(dailyHashtag, analysis);
      console.log('\n=== RESUMO DO DIA ===');
      console.log(summary);
      console.log('===================\n');
      
      // Show trending tags
      if (options.showTrending !== false) {
        await this.showTrendingTags();
      }
      
      // Prompt for posting if not in dry-run mode
      if (!options.dryRun) {
        const shouldPost = await this.promptForPosting();
        if (shouldPost) {
          await this.postSummary(summary, dailyHashtag);
        }
      } else {
        console.log('Modo dry-run: post não publicado.');
        logger.info('Dry-run mode - would have posted summary', { 
          hashtag: dailyHashtag,
          summaryLength: summary.length 
        });
      }
      
      const duration = Date.now() - startTime;
      logger.info('CLI application completed successfully', { duration });
      
    } catch (error) {
      loggers.error('CLI execution failed', error);
      console.error(`\n❌ Erro: ${error.message}`);
      
      // Show helpful error messages
      if (error instanceof ConfigurationError) {
        console.error('\nVerifique suas variáveis de ambiente no arquivo .env');
      }
      
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Validate application configuration
   */
  validateConfiguration() {
    const requiredConfigPaths = [
      { path: ['mastodon', 'url'], name: 'MASTODON_URL' },
      { path: ['mastodon', 'clientKey'], name: 'CLIENT_KEY' },
      { path: ['mastodon', 'clientSecret'], name: 'CLIENT_SECRET' },
      { path: ['mastodon', 'accessToken'], name: 'ACCESS_TOKEN' }
    ];

    const missingVars = requiredConfigPaths
      .filter(({ path }) => {
        const value = path.reduce((obj, key) => obj?.[key], config);
        return !value;
      })
      .map(({ name }) => name);
    
    if (missingVars.length > 0) {
      throw new ConfigurationError(
        `Missing required environment variables: ${missingVars.join(', ')}`,
        { missingVars }
      );
    }

    logger.debug('Configuration validated successfully');
  }

  /**
   * Get the daily hashtag for a specific date
   */
  getDailyHashtag(date = null) {
    const targetDate = date ? new Date(date) : new Date();
    const dayOfWeek = targetDate.getDay();
    
    if (dayOfWeek < 0 || dayOfWeek > 6) {
      throw new BusinessError('Invalid day of week calculated');
    }
    
    const hashtag = HASHTAGS[dayOfWeek];
    
    if (!hashtag) {
      throw new BusinessError(`No hashtag configured for day ${dayOfWeek}`);
    }
    
    return hashtag;
  }

  /**
   * Show trending tags
   */
  async showTrendingTags() {
    try {
      console.log('\n=== TAGS EM ALTA ===');
      const trendingTags = await this.hashtagService.getTrendingTags(5);
      
      if (trendingTags.length === 0) {
        console.log('Nenhuma tag em alta encontrada.');
        return;
      }
      
      trendingTags.forEach((tag, index) => {
        console.log(`${index + 1}. #${tag.name} (${tag.history?.[0]?.uses || 0} usos)`);
      });
      console.log('====================\n');
      
    } catch (error) {
      loggers.error('Failed to fetch trending tags', error);
      console.log('\n⚠️  Não foi possível carregar as tags em alta.');
    }
  }

  /**
   * Prompt user for posting confirmation
   */
  async promptForPosting() {
    const readline = await import('readline');
    
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      rl.question('Deseja publicar este post? (s/N) ', (answer) => {
        rl.close();
        const normalizedAnswer = answer.toLowerCase().trim();
        resolve(normalizedAnswer === 's' || normalizedAnswer === 'sim');
      });
    });
  }

  /**
   * Post the summary to Mastodon
   */
  async postSummary(summary, hashtag) {
    try {
      console.log('\n📤 Publicando post...');
      
      const result = await this.tootService.postSummary(summary, hashtag);
      
      console.log(`✅ Post publicado com sucesso!`);
      console.log(`📝 ID: ${result.id}`);
      console.log(`🔗 URL: ${result.url}`);
      
      loggers.business('summary_posted', {
        tootId: result.id,
        hashtag,
        summaryLength: summary.length
      });
      
    } catch (error) {
      loggers.error('Failed to post summary', error, { hashtag });
      console.error(`\n❌ Falha ao publicar post: ${error.message}`);
      throw error;
    }
  }

  /**
   * Run analysis for a specific hashtag
   */
  async analyzeHashtag(hashtag, options = {}) {
    if (!hashtag) {
      throw new BusinessError('Hashtag is required for analysis');
    }

    logger.info(`Analyzing hashtag: ${hashtag}`, { options });

    try {
      const analysis = await this.hashtagService.analyzeHashtag(hashtag);
      
      console.log(`\n=== ANÁLISE: #${hashtag} ===`);
      console.log(`Total de posts hoje: ${analysis.getTodayCount()}`);
      console.log(`Participantes únicos: ${analysis.getUniqueUserCount()}`);
      console.log(`Posts na semana: ${analysis.getWeeklyTotal()}`);
      
      if (options.showTopToots !== false) {
        const topToots = analysis.getTopToots(5);
        console.log('\nTop posts:');
        topToots.forEach((toot, index) => {
          console.log(`${index + 1}. @${toot.account.username} (Score: ${toot.relevanceScore})`);
        });
      }
      
      console.log('========================\n');
      
      return analysis;
      
    } catch (error) {
      loggers.error(`Failed to analyze hashtag: ${hashtag}`, error);
      console.error(`❌ Falha na análise: ${error.message}`);
      throw error;
    }
  }

  /**
   * Show application status
   */
  async showStatus() {
    console.log('\n=== STATUS DO HASHBOT ===');
    console.log(`Ambiente: ${config.server.environment}`);
    console.log(`Timezone: ${config.server.timezone}`);
    console.log(`API Mastodon: ${config.mastodon.url}`);
    
    try {
      // Test API connectivity
      const trendingTags = await this.hashtagService.getTrendingTags(1);
      console.log(`API Status: ✅ Conectado`);
      console.log(`Tags em alta disponíveis: ${trendingTags.length > 0 ? 'Sim' : 'Não'}`);
    } catch (error) {
      console.log(`API Status: ❌ Erro de conexão`);
      console.log(`Erro: ${error.message}`);
    }
    
    console.log('========================\n');
  }

  /**
   * Handle graceful shutdown
   */
  async shutdown() {
    logger.info('Shutting down CLI application');
    
    if (this.isRunning) {
      console.log('\n⏹️  Encerrando aplicação...');
      this.isRunning = false;
    }
    
    // Close any open connections, cleanup resources
    await this.cleanup();
    
    logger.info('CLI application shutdown complete');
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    // Placeholder for cleanup tasks
    // Close database connections, file handles, etc.
  }

  /**
   * Get application statistics
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      config: {
        environment: config.server.environment,
        timezone: config.server.timezone,
        mastodonUrl: config.mastodon.url
      },
      services: {
        hashtagService: this.hashtagService.getStats(),
        tootService: this.tootService.getStats()
      }
    };
  }
}

// CLI entry point handler
export async function runCLI(args = process.argv) {
  const app = new CLIApplication();
  
  // Parse command line arguments
  const options = parseArguments(args);
  
  // Handle different commands
  try {
    switch (options.command) {
      case 'analyze':
        await app.analyzeHashtag(options.hashtag, options);
        break;
        
      case 'status':
        await app.showStatus();
        break;
        
      case 'help':
        showHelp();
        break;
        
      case 'run':
      default:
        await app.run(options);
        break;
    }
  } catch (error) {
    loggers.error('CLI command failed', error);
    process.exit(1);
  }
}

/**
 * Parse command line arguments
 */
function parseArguments(args) {
  const options = { command: 'run' };
  
  for (let i = 2; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;
        
      case '--no-trending':
        options.showTrending = false;
        break;
        
      case '--date':
        options.date = args[++i];
        break;
        
      case 'analyze':
        options.command = 'analyze';
        options.hashtag = args[++i];
        break;
        
      case 'status':
        options.command = 'status';
        break;
        
      case 'help':
      case '--help':
        options.command = 'help';
        break;
    }
  }
  
  return options;
}

/**
 * Show help information
 */
function showHelp() {
  console.log(`
Hashbot2 - Monitoramento de hashtags do Mastodon

Comandos:
  run                    Executa análise diária (padrão)
  analyze <hashtag>     Analisa hashtag específica
  status                 Mostra status da aplicação
  help                   Mostra esta ajuda

Opções:
  --dry-run             Mostra resumo sem publicar
  --no-trending         Não mostra tags em alta
  --date <YYYY-MM-DD>   Data específica para análise

Exemplos:
  node src/cli/index.js
  node src/cli/index.js --dry-run
  node src/cli/index.js analyze javascript
  node src/cli/index.js status
`);
}

// Handle process signals for graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\nRecebido sinal SIGINT, encerrando...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n\nRecebido sinal SIGTERM, encerrando...');
  process.exit(0);
});