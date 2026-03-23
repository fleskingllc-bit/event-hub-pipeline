#!/usr/bin/env node
/**
 * build-outreach-list.mjs — アウトリーチリスト生成
 *
 * Google Sheetsの承認済みイベント＋出展者データから、
 * Instagram DMアウトリーチ対象リストを生成する。
 *
 * Usage:
 *   node src/build-outreach-list.mjs
 */
import { loadConfig } from './lib/config.js';
import { log } from './lib/logger.js';
import { SheetsStorage, HEADERS } from './storage/sheets.js';
import { randomUUID } from 'crypto';

const BASE_URL = 'https://machi-event-cho.netlify.app';

export async function buildOutreachList(storage) {
  // Ensure outreach sheet exists
  await storage.ensureSheetExists('outreach');

  // Read all data
  const [events, exhibitors, existingOutreach] = await Promise.all([
    storage.readAll('events'),
    storage.readAll('exhibitors'),
    storage.readAll('outreach'),
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + 90);

  // Filter: approved events with date in [today, today+90days]
  const targetEvents = events.filter((e) => {
    if (e.status !== 'approved') return false;
    if (!e.date) return false;
    const eventDate = new Date(e.date);
    return eventDate >= today && eventDate <= maxDate;
  });

  // Sort by date ascending (nearest first)
  targetEvents.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Build exhibitor lookup
  const exhibitorMap = new Map();
  for (const ex of exhibitors) {
    if (ex.status === 'approved' && ex.instagram) {
      exhibitorMap.set(ex.id, ex);
    }
  }

  // Build existing outreach keys for dedup
  const existingKeys = new Set(
    existingOutreach.map((o) => `${o.exhibitorId}__${o.eventId}`)
  );

  // Track recently sent exhibitors (within 30 days)
  const recentlySent = new Set();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  for (const o of existingOutreach) {
    if (o.status === 'sent' && o.sentAt) {
      const sentDate = new Date(o.sentAt);
      if (sentDate >= thirtyDaysAgo) {
        recentlySent.add(o.exhibitorId);
      }
    }
  }

  // Generate outreach entries
  const newEntries = [];

  for (const event of targetEvents) {
    // Parse exhibitorIds
    let exIds = [];
    try {
      exIds = JSON.parse(event.exhibitorIds || '[]');
    } catch {
      continue;
    }

    for (const exId of exIds) {
      const exhibitor = exhibitorMap.get(exId);
      if (!exhibitor) continue;

      // Clean instagram handle
      const ig = exhibitor.instagram.replace(/^@/, '').trim();
      if (!ig) continue;

      // Dedup: same exhibitor + event combo
      const key = `${exId}__${event.id}`;
      if (existingKeys.has(key)) continue;

      // 30-day rule: skip if recently sent
      if (recentlySent.has(exId)) continue;

      const pageUrl = `${BASE_URL}/event/${event.id}`;

      newEntries.push({
        outreachId: `otr_${randomUUID().slice(0, 8)}`,
        exhibitorId: exId,
        exhibitorName: exhibitor.name,
        instagram: `@${ig}`,
        eventId: event.id,
        eventTitle: event.title,
        eventDate: event.date,
        pageUrl,
        message: `${exhibitor.name}さん宛 / ${event.title}`,
        status: 'pending',
        sentAt: '',
        createdAt: new Date().toISOString(),
      });

      // Mark this exhibitor as "will be sent" to avoid duplicates within this batch
      existingKeys.add(key);
    }
  }

  if (!newEntries.length) {
    log.info('Outreach: 新規対象なし');
    return 0;
  }

  // Write to Sheets
  await storage.appendRows('outreach', newEntries);
  log.info(`Outreach: ${newEntries.length}件の新規エントリを追加`);
  return newEntries.length;
}

// Direct execution
if (process.argv[1].endsWith('build-outreach-list.mjs')) {
  const config = loadConfig();
  const storage = new SheetsStorage(config);

  buildOutreachList(storage)
    .then((count) => {
      console.log(`\n✅ ${count}件のアウトリーチエントリを生成しました`);
    })
    .catch((err) => {
      console.error(`❌ エラー: ${err.message}`);
      process.exit(1);
    });
}
