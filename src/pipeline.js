#!/usr/bin/env node
/**
 * Event Hub Pipeline — Main Orchestrator
 *
 * Usage:
 *   node src/pipeline.js              # Full pipeline
 *   node src/pipeline.js --sites-only # Sites only (mypl + tryangle)
 *   node src/pipeline.js --instagram-only # Instagram only
 *   node src/pipeline.js --export-only    # Export JSON only
 */
import { loadConfig } from './lib/config.js';
import { log } from './lib/logger.js';
import { setLastRun } from './lib/state.js';
import { SheetsStorage } from './storage/sheets.js';
import { scrapeMypl } from './scrapers/mypl.js';
import { scrapeTryangle } from './scrapers/tryangle.js';
import { scrapeInstagram } from './scrapers/apify-instagram.js';
import { extractFromSiteData, extractFromCaption } from './ai/event-extractor.js';
import { detectEvent } from './ai/event-detector.js';
import { deduplicateEvents } from './ai/deduplicator.js';
import { geocode } from './geo/geocoder.js';
import { mapAreaFromCoords, mapAreaFromAddress } from './geo/area-mapper.js';
import { exportToJson } from './storage/json-export.js';
import { buildOutreachList } from './build-outreach-list.mjs';
import { createRateLimiter } from './lib/rate-limiter.js';
import { randomUUID } from 'crypto';

const args = process.argv.slice(2);
const sitesOnly = args.includes('--sites-only');
const instagramOnly = args.includes('--instagram-only');
const exportOnly = args.includes('--export-only');
const autoApprove = args.includes('--auto-approve');

async function main() {
  const config = loadConfig();
  const storage = new SheetsStorage(config);
  const runId = randomUUID().slice(0, 8);
  const startTime = new Date().toISOString();

  log.info(`=== Pipeline run ${runId} started ===`);

  // Export only mode
  if (exportOnly) {
    await exportToJson(storage, config);
    return;
  }

  let allExtracted = [];
  const errors = [];

  // --- Site scraping ---
  if (!instagramOnly) {
    // まいぷれ
    try {
      log.info('--- Phase: まいぷれ scraping ---');
      const myplRaw = await scrapeMypl(config);
      if (myplRaw.length) {
        log.info(`--- Phase: まいぷれ AI extraction (${myplRaw.length} events) ---`);
        const myplExtracted = await extractFromSiteData(myplRaw, config);
        allExtracted.push(...myplExtracted);
      }
    } catch (err) {
      log.error(`mypl scraping failed: ${err.message}`);
      errors.push(`mypl: ${err.message}`);
    }

    // TRYangle
    try {
      log.info('--- Phase: TRYangle scraping ---');
      const tryangleRaw = await scrapeTryangle();
      if (tryangleRaw.length) {
        log.info(`--- Phase: TRYangle AI extraction (${tryangleRaw.length} articles) ---`);
        const geminiLimiter = createRateLimiter(1500);
        const tryangleExtracted = [];

        for (const article of tryangleRaw) {
          await geminiLimiter();
          // TRYangle articles often contain multiple events in one article
          const prompt = `以下はTRYangleの記事です。この記事に含まれるイベント情報を全て抽出してください。
複数イベントがある場合は配列で返してください。

タイトル: ${article.title}
本文: ${article.contentText}

JSON形式で出力:
{
  "events": [
    {
      "title": "イベント名",
      "date": "YYYY-MM-DD",
      "dateEnd": "",
      "dayOfWeek": "",
      "time": "HH:MM-HH:MM",
      "location": "会場名",
      "address": "山口県を含む住所",
      "area": "市名",
      "description": "200文字以内の概要",
      "fee": "料金"
    }
  ]
}

年が不明な場合は2026年。`;
          const { GeminiClient } = await import('./ai/gemini.js');
          const gemini = new GeminiClient(config);
          const result = await gemini.generateContent(prompt);

          if (result.events && Array.isArray(result.events)) {
            for (const event of result.events) {
              tryangleExtracted.push({
                ...event,
                source: 'tryangle',
                sourceUrl: article.link,
                images: article.images || [],
                exhibitors: [],
              });
            }
          } else if (result.title) {
            // Single event returned
            tryangleExtracted.push({
              ...result,
              source: 'tryangle',
              sourceUrl: article.link,
              images: article.images || [],
              exhibitors: [],
            });
          }
        }

        allExtracted.push(...tryangleExtracted);
        log.info(`TRYangle extracted: ${tryangleExtracted.length} events`);
      }
    } catch (err) {
      log.error(`TRYangle scraping failed: ${err.message}`);
      errors.push(`tryangle: ${err.message}`);
    }
  }

  // --- Instagram ---
  if (!sitesOnly) {
    try {
      log.info('--- Phase: Instagram scraping ---');
      const igPosts = await scrapeInstagram(config);

      if (igPosts.length) {
        log.info(`--- Phase: Instagram event detection (${igPosts.length} posts) ---`);
        const geminiLimiter = createRateLimiter(1500);
        const igPostRecords = [];
        const igEvents = [];

        for (const post of igPosts) {
          await geminiLimiter();

          // Detect if event
          const detection = await detectEvent(post.caption, config);
          const isEvent = detection.is_event && detection.event_type === '告知';

          // Record in instagram_posts sheet
          igPostRecords.push({
            postId: post.postId,
            accountName: post.accountName,
            caption: post.caption.slice(0, 500),
            timestamp: post.timestamp,
            hashtags: JSON.stringify(post.hashtags),
            imageUrls: JSON.stringify(post.imageUrls.slice(0, 5)),
            isEventRelated: isEvent ? 'TRUE' : 'FALSE',
            extractedEventId: '',
            processedAt: new Date().toISOString(),
          });

          if (isEvent) {
            await geminiLimiter();
            const extracted = await extractFromCaption(post.caption, config);
            if (extracted && !extracted.error) {
              igEvents.push({
                ...extracted,
                source: 'instagram',
                sourceUrl: `https://www.instagram.com/p/${post.postId}/`,
                images: post.imageUrls,
                exhibitors: extracted.exhibitors || [],
              });
            }
          }
        }

        // Write IG posts to sheets
        if (igPostRecords.length) {
          await storage.appendRows('instagram_posts', igPostRecords);
        }
        allExtracted.push(...igEvents);
        log.info(`Instagram: ${igEvents.length} event posts detected`);
      }
    } catch (err) {
      log.error(`Instagram scraping failed: ${err.message}`);
      errors.push(`instagram: ${err.message}`);
    }
  }

  if (!allExtracted.length) {
    log.info('No new events extracted');
    await logRun(storage, runId, startTime, 0, errors);
    return;
  }

  // --- Deduplication ---
  log.info(`--- Phase: Deduplication (${allExtracted.length} events) ---`);
  const deduped = await deduplicateEvents(allExtracted, config);
  log.info(`After dedup: ${deduped.length} events`);

  // --- Geocoding + Area mapping ---
  log.info('--- Phase: Geocoding ---');
  for (const event of deduped) {
    if (event.address && (!event.lat || !event.lng)) {
      const geo = await geocode(event.address);
      if (geo) {
        event.lat = geo.lat;
        event.lng = geo.lng;
        if (!event.area) {
          event.area = mapAreaFromCoords(geo.lat, geo.lng);
        }
      }
    }
    // Fallback area from address
    if (!event.area && event.address) {
      event.area = mapAreaFromAddress(event.address);
    }
  }

  // --- Write to Sheets ---
  log.info('--- Phase: Writing to Sheets ---');
  const eventRows = deduped.map((e, i) => ({
    id: `evt_${runId}_${String(i).padStart(3, '0')}`,
    title: e.title || '',
    date: e.date || '',
    dayOfWeek: e.dayOfWeek || '',
    time: e.time || '',
    location: e.location || '',
    address: e.address || '',
    lat: e.lat || '',
    lng: e.lng || '',
    area: e.area || '',
    description: (e.description || '').slice(0, 500),
    exhibitorIds: JSON.stringify([]),
    imageCount: String((e.images || []).length),
    status: autoApprove ? 'approved' : 'pending_review',
    source: e.source || '',
    sourceUrl: e.sourceUrl || '',
    createdAt: new Date().toISOString(),
  }));

  // Write exhibitors from Instagram extractions and link to events
  const exhibitorRows = [];
  for (let i = 0; i < deduped.length; i++) {
    const event = deduped[i];
    if (event.exhibitors?.length) {
      const ids = [];
      for (const ex of event.exhibitors) {
        const exId = `exh_${runId}_${String(exhibitorRows.length).padStart(3, '0')}`;
        ids.push(exId);
        // Skip junk names (category names as exhibitor names)
        const name = (ex.name || '').trim();
        if (!name || name.length <= 1) continue;
        exhibitorRows.push({
          id: exId,
          name,
          category: ex.category || '',
          categoryTag: ex.category || '',
          instagram: ex.instagram || '',
          description: ex.description || ex.menu || '',
          menu: JSON.stringify(Array.isArray(ex.menu) ? ex.menu : []),
          status: autoApprove ? 'approved' : 'pending_review',
          createdAt: new Date().toISOString(),
        });
      }
      // Link exhibitor IDs back to the event row
      eventRows[i].exhibitorIds = JSON.stringify(ids);
    }
  }

  if (eventRows.length) await storage.appendRows('events', eventRows);
  if (exhibitorRows.length) await storage.appendRows('exhibitors', exhibitorRows);

  // --- Log run ---
  await logRun(storage, runId, startTime, eventRows.length, errors);

  log.info(`=== Pipeline run ${runId} complete: ${eventRows.length} events written ===`);

  // Auto-export when auto-approve is on
  if (autoApprove && eventRows.length > 0) {
    log.info('--- Phase: Auto-export ---');
    await exportToJson(storage, config);
  }

  // Build outreach list (always runs when auto-approve is on)
  if (autoApprove) {
    try {
      log.info('--- Phase: Outreach list generation ---');
      await buildOutreachList(storage);
    } catch (err) {
      log.error(`Outreach list generation failed: ${err.message}`);
    }
  }
}

async function logRun(storage, runId, startTime, newCount, errors) {
  const sources = [sitesOnly ? 'sites' : '', instagramOnly ? 'instagram' : '', !sitesOnly && !instagramOnly ? 'all' : ''].filter(Boolean).join(',') || 'all';
  await storage.appendRows('scrape_log', [{
    runId,
    source: sources,
    startTime,
    endTime: new Date().toISOString(),
    newCount: String(newCount),
    errors: errors.join('; ') || '',
    status: errors.length ? 'completed_with_errors' : 'completed',
  }]);
  setLastRun(sources, new Date().toISOString());
}

main().catch((err) => {
  log.error(`Pipeline fatal error: ${err.message}`);
  log.error(err.stack);
  process.exit(1);
});
