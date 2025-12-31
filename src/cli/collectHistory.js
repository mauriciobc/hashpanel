/**
 * CLI script to collect hashtag history data
 * Can be run manually or via cron job
 * 
 * Usage:
 *   node src/cli/collectHistory.js                    # Collect today's data
 *   node src/cli/collectHistory.js --date 2024-01-15  # Collect specific date
 *   node src/cli/collectHistory.js --range 2024-01-01 2024-01-31  # Collect date range
 *   node src/cli/collectHistory.js --last-7-days      # Collect last 7 days
 */

import { historyCollector } from '../services/historyCollector.js';
import { logger } from '../utils/logger.js';
import { getDatabase } from '../database/index.js';
import moment from 'moment-timezone';

async function main() {
  let database;
  const args = process.argv.slice(2);
  let exitCode = 0;
  
  try {
    // Initialize database connection
    database = getDatabase();
    // Parse arguments
    const dateIndex = args.indexOf('--date');
    const rangeIndex = args.indexOf('--range');
    const last7DaysIndex = args.indexOf('--last-7-days');
    
    // Validate mutual exclusivity
    const flagCount = [dateIndex, rangeIndex, last7DaysIndex].filter(idx => idx !== -1).length;
    if (flagCount > 1) {
      console.error('Error: Flags --date, --range, and --last-7-days are mutually exclusive');
      exitCode = 1;
      return;
    }
    
    if (last7DaysIndex !== -1) {
      // Collect last 7 days
      const endDate = moment().format('YYYY-MM-DD');
      const startDate = moment().subtract(7, 'days').format('YYYY-MM-DD');
      
      console.log(`Collecting history data from ${startDate} to ${endDate} (last 7 days)...`);
      const summary = await historyCollector.collectDateRange(startDate, endDate);
      
      console.log('\nCollection Summary:');
      console.log(`  Date Range: ${startDate} to ${endDate}`);
      console.log(`  Total Days: ${summary.totalDays}`);
      console.log(`  Collected: ${summary.totalCollected}`);
      console.log(`  Skipped: ${summary.totalSkipped}`);
      console.log(`  Errors: ${summary.totalErrors}`);
      
    } else if (rangeIndex !== -1) {
      // Collect date range
      const startDate = args[rangeIndex + 1];
      const endDate = args[rangeIndex + 2];
      
      if (!startDate || !endDate) {
        console.error('Error: --range requires start and end dates (YYYY-MM-DD)');
        exitCode = 1;
        return;
      }
      
      console.log(`Collecting history data from ${startDate} to ${endDate}...`);
      const summary = await historyCollector.collectDateRange(startDate, endDate);
      
      console.log('\nCollection Summary:');
      console.log(`  Date Range: ${startDate} to ${endDate}`);
      console.log(`  Total Days: ${summary.totalDays}`);
      console.log(`  Collected: ${summary.totalCollected}`);
      console.log(`  Skipped: ${summary.totalSkipped}`);
      console.log(`  Errors: ${summary.totalErrors}`);
      
    } else if (dateIndex !== -1) {
      // Collect specific date
      const date = args[dateIndex + 1];
      
      if (!date) {
        console.error('Error: --date requires a date (YYYY-MM-DD)');
        exitCode = 1;
        return;
      }
      
      console.log(`Collecting history data for ${date}...`);
      const summary = await historyCollector.collectAllHashtags(date);
      
      console.log('\nCollection Summary:');
      console.log(`  Date: ${summary.date}`);
      console.log(`  Total Hashtags: ${summary.totalHashtags}`);
      console.log(`  Collected: ${summary.collected}`);
      console.log(`  Skipped: ${summary.skipped}`);
      console.log(`  Errors: ${summary.errors}`);
      
    } else {
      // Collect today's data (default)
      console.log('Collecting today\'s history data for all hashtags...');
      const summary = await historyCollector.collectAllHashtags();
      
      console.log('\nCollection Summary:');
      console.log(`  Date: ${summary.date}`);
      console.log(`  Total Hashtags: ${summary.totalHashtags}`);
      console.log(`  Collected: ${summary.collected}`);
      console.log(`  Skipped: ${summary.skipped}`);
      console.log(`  Errors: ${summary.errors}`);
    }
    
    console.log('\n✅ Collection completed successfully');
    
  } catch (error) {
    exitCode = 1;
    logger.error('Collection script failed', error);
    console.error('\n❌ Collection failed:', error.message);
  } finally {
    // Close database connection
    if (database) {
      database.close();
    }
  }
  
  process.exit(exitCode);
}

// Run the script
main();
