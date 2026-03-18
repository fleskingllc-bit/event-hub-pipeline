import { chromium } from 'playwright';
import { log } from '../lib/logger.js';
import { createRateLimiter } from '../lib/rate-limiter.js';
import { isProcessed, markProcessed } from '../lib/state.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('../../', import.meta.url).pathname;
const RAW_DIR = join(ROOT, 'data', 'raw', 'mypl');
mkdirSync(RAW_DIR, { recursive: true });

const SITES = [
  { name: 'mypl_shunan', baseUrl: 'https://shunan.mypl.net/event/' },
  { name: 'mypl_yamaguchi', baseUrl: 'https://yamaguchi.mypl.net/event/' },
];

/**
 * Phase 1: Collect event URLs from list pages
 */
async function collectEventUrls(page, baseUrl, maxPages = 5) {
  const allEvents = [];
  let currentUrl = baseUrl;

  for (let pg = 1; pg <= maxPages; pg++) {
    log.info(`Fetching list page ${pg}: ${currentUrl}`);
    await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const pageEvents = await page.evaluate(() => {
      const results = [];

      // Pattern 1: li.event_list_li (shunan style)
      const items = document.querySelectorAll('li.event_list_li');
      items.forEach((li) => {
        const category = li.querySelector('span.select_index')?.textContent?.trim() || '';
        const a = li.querySelector('a[href*="/event/"]');
        const title = a?.textContent?.trim() || '';
        const href = a?.getAttribute('href') || '';
        const idMatch = href.match(/\/event\/(\d+)\//);
        if (idMatch) results.push({ id: idMatch[1], title, category, url: href });
      });

      // Pattern 2: table#ajaxContentTable (yamaguchi style)
      if (!results.length) {
        const table = document.querySelector('#ajaxContentTable');
        if (table) {
          table.querySelectorAll('a[href*="/event/"]').forEach((a) => {
            const href = a.getAttribute('href') || '';
            const idMatch = href.match(/\/event\/(\d+)\//);
            const title = a.textContent?.trim() || '';
            const category = a.previousElementSibling?.textContent?.trim() || '';
            if (idMatch) results.push({ id: idMatch[1], title, category, url: href });
          });
        }
      }

      return results;
    });

    allEvents.push(...pageEvents);
    log.info(`  Found ${pageEvents.length} events on page ${pg}`);

    // Check for "さらに読み込む" button
    const nextUrl = await page.evaluate(() => {
      const btn = document.querySelector('a.btn_more_a');
      return btn?.getAttribute('href') || null;
    });

    if (!nextUrl) {
      log.info('  No more pages');
      break;
    }

    // Resolve relative URL
    currentUrl = nextUrl.startsWith('//') ? 'https:' + nextUrl
      : nextUrl.startsWith('/') ? new URL(nextUrl, baseUrl).href
      : nextUrl;
  }

  return allEvents;
}

/**
 * Phase 2: Scrape event detail page
 */
async function scrapeEventDetail(page, url) {
  const fullUrl = url.startsWith('//') ? 'https:' + url
    : url.startsWith('/') ? 'https://shunan.mypl.net' + url
    : url;

  await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  const detail = await page.evaluate(() => {
    // Title: second h1 or div.ttl_bg
    const h1s = document.querySelectorAll('h1');
    const title = (h1s.length > 1 ? h1s[1]?.textContent?.trim() : null)
      || document.querySelector('.ttl_bg')?.textContent?.trim()
      || '';

    // Table data
    const tableData = {};
    const rows = document.querySelectorAll('.co_main table tr, table tr');
    rows.forEach((tr) => {
      const th = tr.querySelector('th')?.textContent?.trim();
      const td = tr.querySelector('td');
      if (th && td) {
        tableData[th] = {
          text: td.textContent?.trim() || '',
          html: td.innerHTML || '',
        };
      }
    });

    // Description
    const descEl = document.querySelector('.co_full_box');
    const description = descEl?.textContent?.trim() || '';

    // Images
    const images = Array.from(
      document.querySelectorAll('.co_main img, .co_full_box img')
    )
      .map((img) => img.src)
      .filter((src) => src && !src.includes('static.mypl.net'));

    return { title, tableData, description, images };
  });

  // Parse structured fields from table
  const locationHtml = detail.tableData['開催場所']?.html || '';
  const locationParts = locationHtml.split('<br>').map((s) => s.replace(/<[^>]*>/g, '').trim()).filter(Boolean);

  return {
    title: detail.title,
    category: detail.tableData['カテゴリ']?.text || '',
    dateRaw: detail.tableData['開催日']?.text || '',
    locationName: locationParts[0] || '',
    address: locationParts.slice(1).find((p) => p.includes('県') || p.includes('市')) || locationParts[1] || '',
    fee: detail.tableData['料金']?.text || '',
    officialUrl: detail.tableData['イベントの公式URL(PC)']?.text || '',
    contact: detail.tableData['お問い合わせ先']?.text || '',
    description: detail.description,
    images: detail.images,
    sourceUrl: fullUrl,
  };
}

/**
 * Main scraper function
 */
export async function scrapeMypl(config) {
  const rateLimiter = createRateLimiter(config?.scraping?.requestIntervalMs || 3000);
  const results = [];

  const browser = await chromium.launch({ headless: true });

  try {
    for (const site of SITES) {
      log.info(`=== Scraping ${site.name} ===`);
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      });
      const page = await context.newPage();

      // Phase 1: Collect event URLs
      const eventList = await collectEventUrls(page, site.baseUrl);
      log.info(`Total events found: ${eventList.length}`);

      // Phase 2: Scrape details for unprocessed events
      let newCount = 0;
      for (const event of eventList) {
        if (isProcessed(site.name, event.id)) {
          log.debug(`Skip (already processed): ${event.id}`);
          continue;
        }

        await rateLimiter();

        try {
          log.info(`Scraping detail: ${event.id} - ${event.title}`);
          const detail = await scrapeEventDetail(page, event.url);
          detail.sourceId = event.id;
          detail.source = site.name;
          detail.category = detail.category || event.category;

          // Save raw data
          writeFileSync(
            join(RAW_DIR, `${site.name}_${event.id}.json`),
            JSON.stringify(detail, null, 2)
          );

          results.push(detail);
          markProcessed(site.name, event.id);
          newCount++;
        } catch (err) {
          log.error(`Failed to scrape ${event.id}: ${err.message}`);
        }
      }

      log.info(`${site.name}: ${newCount} new events scraped`);
      await context.close();
    }
  } finally {
    await browser.close();
  }

  return results;
}
