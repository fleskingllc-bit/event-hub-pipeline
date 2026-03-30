import { log } from '../lib/logger.js';
import { isProcessed, markProcessed } from '../lib/state.js';
import { createRateLimiter } from '../lib/rate-limiter.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('../../', import.meta.url).pathname;
const RAW_DIR = join(ROOT, 'data', 'raw', 'shunan-keizai');
mkdirSync(RAW_DIR, { recursive: true });

const BASE_URL = 'https://shunan.keizai.biz';

/**
 * Strip HTML tags, decode entities
 */
function stripHtml(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove script blocks
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')   // Remove style blocks
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
    const src = m[1];
    if (!src.includes('gravatar') && !src.includes('icon') && !src.includes('logo')) {
      // Resolve relative URLs
      const url = src.startsWith('http') ? src : `${BASE_URL}${src}`;
      images.push(url);
    }
  }
  return images;
}

/**
 * Extract article IDs from top page HTML
 */
function extractArticleIds(html) {
  const re = /\/headline\/(\d+)\//g;
  const ids = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    ids.add(m[1]);
  }
  return [...ids];
}

/**
 * Parse individual article page
 * Structure: <div class="contents" id="topBox"> contains:
 *   <div class="ttl"> → <time>, <h1> (article title)
 *   <div class="main"> → hero image
 *   <div class="gallery"> → photo gallery
 *   <div class="txt"> → article body <p> tags
 */
function parseArticle(html, id) {
  // Extract the topBox area first
  const topBoxMatch = html.match(/<div[^>]*id="topBox"[^>]*>([\s\S]*?)<ul class="btnList/i);
  const topBox = topBoxMatch ? topBoxMatch[1] : html;

  // Title: <h1> inside <div class="ttl"> (not the site logo h1)
  const ttlMatch = topBox.match(/<div class="ttl">([\s\S]*?)<\/div>/i);
  let title = '';
  if (ttlMatch) {
    const h1Match = ttlMatch[1].match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    title = h1Match ? stripHtml(h1Match[1]) : '';
  }

  // Date: <time> tag inside ttl
  let date = '';
  if (ttlMatch) {
    const timeMatch = ttlMatch[1].match(/<time[^>]*>([\s\S]*?)<\/time>/i);
    if (timeMatch) {
      const dateStr = timeMatch[1].trim();
      const datePartMatch = dateStr.match(/(\d{4})[\.\/](\d{1,2})[\.\/](\d{1,2})/);
      if (datePartMatch) {
        date = `${datePartMatch[1]}.${datePartMatch[2].padStart(2, '0')}.${datePartMatch[3].padStart(2, '0')}`;
      }
    }
  }

  // Content: <div class="txt"> area
  const txtMatch = topBox.match(/<div class="txt">([\s\S]*?)<\/div>\s*<\/div>/i);
  const contentHtml = txtMatch ? txtMatch[1] : '';
  const contentText = stripHtml(contentHtml);

  // Images: hero image from <div class="main"> + gallery images
  const images = [];
  const mainMatch = topBox.match(/<div class="main">([\s\S]*?)<\/div>/i);
  if (mainMatch) {
    images.push(...extractImages(mainMatch[1]));
  }
  const galleryMatch = topBox.match(/<div class="gallery">([\s\S]*?)<\/div>/i);
  if (galleryMatch) {
    images.push(...extractImages(galleryMatch[1]));
  }

  return {
    title,
    date,
    contentText,
    contentHtml,
    images,
    sourceUrl: `${BASE_URL}/headline/${id}/`,
    sourceId: id,
    source: 'shunan_keizai',
  };
}

/**
 * Scrape Shunan Keizai Shinbun
 */
export async function scrapeShunanKeizai(config) {
  log.info('=== Scraping 周南経済新聞 ===');

  const intervalMs = config.scraping?.requestIntervalMs || 3000;
  const limiter = createRateLimiter(intervalMs);

  // 1. Fetch top page
  const res = await fetch(BASE_URL, {
    headers: { 'User-Agent': 'EventHubPipeline/1.0' },
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    throw new Error(`Shunan Keizai top page fetch failed: ${res.status}`);
  }

  const topHtml = await res.text();

  // 2. Extract article IDs
  const articleIds = extractArticleIds(topHtml);
  log.info(`Found ${articleIds.length} article links`);

  // 3. Process each article
  const results = [];

  for (const id of articleIds) {
    if (isProcessed('shunan_keizai', id)) {
      log.debug(`Skip (already processed): ${id}`);
      continue;
    }

    await limiter();

    try {
      const articleRes = await fetch(`${BASE_URL}/headline/${id}/`, {
        headers: { 'User-Agent': 'EventHubPipeline/1.0' },
        signal: AbortSignal.timeout(30000),
      });

      if (!articleRes.ok) {
        log.warn(`Article ${id} fetch failed: ${articleRes.status}`);
        continue;
      }

      const articleHtml = await articleRes.text();
      const parsed = parseArticle(articleHtml, id);

      if (!parsed.title || parsed.title === 'ページが見つかりませんでした') {
        log.warn(`Article ${id}: no valid title, skipping`);
        markProcessed('shunan_keizai', id); // Don't retry 404s
        continue;
      }

      // Save raw data
      writeFileSync(
        join(RAW_DIR, `${id}.json`),
        JSON.stringify(parsed, null, 2)
      );

      results.push(parsed);
      markProcessed('shunan_keizai', id);
      log.info(`Scraped: ${parsed.title}`);
    } catch (err) {
      log.warn(`Article ${id} error: ${err.message}`);
    }
  }

  log.info(`周南経済新聞: ${results.length} new articles`);
  return results;
}
