import { log } from '../lib/logger.js';
import { isProcessed, markProcessed } from '../lib/state.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('../../', import.meta.url).pathname;
const RAW_DIR = join(ROOT, 'data', 'raw', 'tryangle');
mkdirSync(RAW_DIR, { recursive: true });

const FEED_URL = 'https://tryangle.yamaguchi.jp/category/event/feed/';

/**
 * Simple XML text extraction (no dependency needed for RSS)
 */
function extractTag(xml, tag) {
  // Handle both regular tags and namespaced tags like content:encoded
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${escaped}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${escaped}>|<${escaped}[^>]*>([\\s\\S]*?)</${escaped}>`, 'i');
  const m = xml.match(re);
  return m ? (m[1] || m[2] || '').trim() : '';
}

function extractAllTags(xml, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${escaped}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${escaped}>|<${escaped}[^>]*>([\\s\\S]*?)</${escaped}>`, 'gi');
  const results = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    results.push((m[1] || m[2] || '').trim());
  }
  return results;
}

/**
 * Strip HTML tags, decode entities
 */
function stripHtml(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract images from HTML content
 */
function extractImages(html) {
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  const images = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    if (!m[1].includes('gravatar') && !m[1].includes('icon')) {
      images.push(m[1]);
    }
  }
  return images;
}

/**
 * Scrape TRYangle RSS feed
 */
export async function scrapeTryangle() {
  log.info('=== Scraping TRYangle RSS ===');

  const res = await fetch(FEED_URL, {
    headers: { 'User-Agent': 'EventHubPipeline/1.0' },
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    throw new Error(`TRYangle RSS fetch failed: ${res.status}`);
  }

  const xml = await res.text();

  // Split into items
  const itemBlocks = xml.split('<item>').slice(1).map((block) => block.split('</item>')[0]);
  log.info(`Found ${itemBlocks.length} items in RSS feed`);

  const results = [];

  for (const block of itemBlocks) {
    const link = extractTag(block, 'link');
    const guid = extractTag(block, 'guid');
    // Use guid or link as unique ID
    const id = guid || link;
    const idHash = id.replace(/[^a-zA-Z0-9]/g, '_').slice(-60);

    if (isProcessed('tryangle', idHash)) {
      log.debug(`Skip (already processed): ${idHash}`);
      continue;
    }

    const title = extractTag(block, 'title');
    const pubDate = extractTag(block, 'pubDate');
    const contentEncoded = extractTag(block, 'content:encoded');
    const description = extractTag(block, 'description');
    const categories = extractAllTags(block, 'category');

    const contentText = stripHtml(contentEncoded || description);
    const images = extractImages(contentEncoded);

    const rawData = {
      title,
      link,
      guid,
      pubDate,
      categories,
      contentText,
      contentHtml: contentEncoded,
      description: stripHtml(description),
      images,
      source: 'tryangle',
      sourceUrl: link,
    };

    // Save raw data
    writeFileSync(
      join(RAW_DIR, `${idHash}.json`),
      JSON.stringify(rawData, null, 2)
    );

    results.push(rawData);
    markProcessed('tryangle', idHash);
  }

  log.info(`TRYangle: ${results.length} new articles`);
  return results;
}
