import fs from 'fs/promises';
import { CONFIG, stats, log, ensureDir, generateIndex, printSummary } from './utils.js';
import { processPageRecursively } from './notion.js';

/**
 * Validate required environment variables
 * @throws {Error} If required variables are missing
 */
function validateEnvironment() {
  const rootPageId = process.env.NOTION_ROOT_PAGE_ID;
  const notionToken = process.env.NOTION_TOKEN;
  
  if (!rootPageId) {
    throw new Error('NOTION_ROOT_PAGE_ID environment variable not set!');
  }
  
  if (!notionToken) {
    throw new Error('NOTION_TOKEN environment variable not set!');
  }
  
  return { rootPageId, notionToken };
}

/**
 * Clean output directory if configured
 */
async function cleanOutputDirectory() {
  if (CONFIG.CLEAN_OUTPUT) {
    log.info('Cleaning output directory...');
    await fs.rm(CONFIG.OUTPUT_DIR, { recursive: true, force: true });
  }
}

/**
 * Print startup banner
 */
function printBanner() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   Notion Recursive Backup Started      ║');
  console.log('╚════════════════════════════════════════╝\n');
}

/**
 * Print configuration info
 * @param {string} rootPageId - Root page ID to backup
 */
function printConfig(rootPageId) {
  log.info(`Root page ID: ${rootPageId}`);
  log.info(`Output directory: ${CONFIG.OUTPUT_DIR}`);
  log.info(`Parallel processing: ${CONFIG.PARALLEL_PROCESSING}`);
  log.info(`API delay: ${CONFIG.API_DELAY}ms\n`);
}

/**
 * Main backup function
 * Orchestrates the entire backup process
 */
async function main() {
  try {
    // Print banner
    printBanner();
    
    // Validate environment
    const { rootPageId } = validateEnvironment();
    
    // Print configuration
    printConfig(rootPageId);
    
    // Clean output directory
    await cleanOutputDirectory();
    
    // Ensure output directory exists
    await ensureDir(CONFIG.OUTPUT_DIR);
    
    // Start recursive backup
    log.info('Starting recursive page processing...\n');
    await processPageRecursively(rootPageId);
    
    // Generate index file
    log.info('\nGenerating backup index...');
    await generateIndex(rootPageId);
    
    // Print summary
    printSummary(rootPageId);
    
    // Exit with error code if there were errors
    if (stats.errors > 0) {
      process.exit(1);
    }
    
  } catch (error) {
    log.error(`Fatal error: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// Run the backup
main();
