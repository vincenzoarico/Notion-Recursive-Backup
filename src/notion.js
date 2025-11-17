import { Client } from '@notionhq/client';
import { NotionConverter } from 'notion-to-md';
import fs from 'fs/promises';
import * as path from 'path';
import { 
  CONFIG, 
  stats, 
  log, 
  sleep, 
  sanitizeFilename, 
  ensureDir, 
  generateFrontmatter 
} from './utils.js';

// Initialize Notion clients
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const n2m = new NotionConverter(notion);

/**
 * Get page title from Notion API with robust error handling
 * Handles both regular pages and database pages
 * @param {string} pageId - Notion page ID
 * @returns {Promise<string>} Page title or fallback
 */
export async function getPageTitle(pageId) {
  try {
    await sleep(CONFIG.API_DELAY);
    const page = await notion.pages.retrieve({ page_id: pageId });
    
    const properties = page.properties;
    
    const titleProp = Object.values(properties).find(prop => prop.type === 'title');
    
    if (titleProp?.title?.length > 0) {
      return titleProp.title[0].plain_text;
    } 
    
    return `Untitled-${pageId.substring(0, 8)}`;
  } catch (error) {
    log.error(`Failed to retrieve title for ${pageId}: ${error.message}`);
    return `Untitled-${pageId.substring(0, 8)}`;
  }
}

/**
 * Get all child pages of a block with pagination support
 * @param {string} pageId - Parent page ID
 * @returns {Promise<Array>} Array of child page objects
 */
export async function getChildPages(pageId, pageIdTitle) {
  const children = [];
  let cursor = undefined;
  
  try {
    do {
      await sleep(CONFIG.API_DELAY);
      const response = await notion.blocks.children.list({
        block_id: pageId,
        start_cursor: cursor,
        page_size: 100
      });
      log.debug(`Children list:\n${response}\n`);
      
      for (const block of response.results) {
        if (block.type === 'child_page') {
          log.debug(`Retrivied child page ${block.child_page.title} of page ${pageIdTitle}`);
          children.push({
            id: block.id,
            title: block.child_page.title
          });
        }
      }
      
      cursor = response.next_cursor;
    } while (cursor);
    
    return children;
  } catch (error) {
    log.error(`Failed to retrieve child pages for ${pageId}: ${error.message}`);
    return [];
  }
}

/**
 * Convert a Notion page to markdown string
 * @param {string} pageId - Notion page ID
 * @returns {Promise<string>} Markdown content
 */
export async function convertPageToMarkdown(pageId) {
  try {
    await sleep(CONFIG.API_DELAY);
    const page = await n2m.convert(pageId); 
    return page;
  } catch (error) {
    log.error(`Failed to convert page ${pageId}: ${error.message}`);
    throw error;
  }
}

/**
 * Process a single page: convert and save to file
 * @param {string} pageId - Notion page ID
 * @param {string} parentPath - Output directory path
 * @param {number} level - Nesting level for logging
 * @returns {Promise<Object>} Object with title and filename
 */
export async function processPage(pageId, parentPath, level) {
  const indent = '  '.repeat(level);
  
  try {
    log.info(`${indent}Processing: ${pageId}`);
    
    const title = await getPageTitle(pageId);
    log.debug(`${indent}Title: "${title}"`);
    
    const markdown = await convertPageToMarkdown(pageId);
    
    const frontmatter = generateFrontmatter(title, pageId, parentPath, level);
    const fullMarkdown = frontmatter + markdown;
    
    await ensureDir(parentPath);
    const filename = sanitizeFilename(title) + '.md';
    const filepath = path.join(parentPath, filename);
    await fs.writeFile(filepath, fullMarkdown, 'utf8');
    
    log.success(`${indent}Saved: ${filename}`);
    stats.pagesProcessed++;
    
    return { title, filename };
  } catch (error) {
    log.error(`${indent}Failed to process page: ${error.message}`);
    stats.errors++;
    throw error;
  }
}

/**
 * Process a page and all its children recursively
 * @param {string} pageId - Root page ID
 * @param {string} parentPath - Output directory path
 * @param {number} level - Current nesting level
 */
export async function processPageRecursively(pageId, parentPath = CONFIG.OUTPUT_DIR, level = 0) {
  const indent = '  '.repeat(level);
  
  try {
    const { title } = await processPage(pageId, parentPath, level);
    
    const childPages = await getChildPages(pageId, title);
    
    if (childPages.length > 0) {
      log.info(`${indent}Found ${childPages.length} child page(s)`);
      
      const childDir = path.join(parentPath, sanitizeFilename(title));
      await ensureDir(childDir);
      
      if (CONFIG.PARALLEL_PROCESSING) {
        // Process children in parallel for better performance
        const childPromises = childPages.map(child =>
          processPageRecursively(child.id, childDir, level + 1)
            .catch(error => {
              log.error(`${indent}  Child page ${child.id} failed: ${error.message}`);
              stats.errors++;
            })
        );
        await Promise.all(childPromises);
      } else {
        // Process children sequentially (safer but slower)
        for (const child of childPages) {
          try {
            await processPageRecursively(child.id, childDir, level + 1);
          } catch (error) {
            log.error(`${indent}  Child page ${child.id} failed: ${error.message}`);
            stats.errors++;
          }
        }
      }
    }
  } catch (error) {
    log.error(`${indent}Failed to process page tree: ${error.message}`);
    stats.errors++;
  }
}

export async function processWorkspaceRoot(){
  console.log("Searching all workspace pages...");
  try {
    const response = await notion.search({
      filter: {
        value: 'page',
        property: 'object'
      },
    });
    console.log(`---\n${response}---\n`);
  });

  } catch (error) {
    console.error("Error during the search:", error.message);
  }
}
