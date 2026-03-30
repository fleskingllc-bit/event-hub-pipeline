#!/usr/bin/env node
/**
 * build-outreach-list.mjs — アウトリーチリスト生成
 *
 * Google Sheetsの承認済みイベント＋出展者データから、
 * Instagram DMアウトリーチ対象リストを生成する。
 *
 * スパム防止ルール:
 *   - イベント×出展者単位で基本1 DM（重複送信防止）
 *   - 出展者グローバルクールダウン: 14日（異なるイベントでも同一出展者は14日間隔）
 *   - 出展者あたり月間上限: 3件/月
 *   - リマインダー: イベント3〜7日前 && 1回目から14日以上経過
 *
 * Usage:
 *   node src/build-outreach-list.mjs
 */
import { loadConfig } from './lib/config.js';
import { log } from './lib/logger.js';
import { SheetsStorage, HEADERS } from './storage/sheets.js';
import { randomUUID } from 'crypto';

const BASE_URL = 'https://machi-event-cho.netlify.app';
const COOLDOWN_DAYS = 14;
const MONTHLY_LIMIT_PER_EXHIBITOR = 3;

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

  // Build existing outreach keys for dedup (event × exhibitor)
  const existingKeys = new Set(
    existingOutreach.map((o) => `${o.exhibitorId}__${o.eventId}`)
  );

  // Track recently sent exhibitors (within cooldown period: 14 days)
  const recentlySent = new Set();
  const cooldownDate = new Date(today);
  cooldownDate.setDate(cooldownDate.getDate() - COOLDOWN_DAYS);
  for (const o of existingOutreach) {
    if (o.status === 'sent' && o.sentAt) {
      const sentDate = new Date(o.sentAt);
      if (sentDate >= cooldownDate) {
        recentlySent.add(o.exhibitorId);
      }
    }
  }

  // Monthly send count per exhibitor (max 3/month)
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthlySentCount = new Map();
  for (const o of existingOutreach) {
    if (o.status === 'sent' && o.sentAt && new Date(o.sentAt) >= monthStart) {
      monthlySentCount.set(o.exhibitorId, (monthlySentCount.get(o.exhibitorId) || 0) + 1);
    }
  }

  // Generate new outreach entries
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

      // Cooldown: skip if sent within 14 days
      if (recentlySent.has(exId)) continue;

      // Monthly limit: skip if already sent 3+ this month
      if ((monthlySentCount.get(exId) || 0) >= MONTHLY_LIMIT_PER_EXHIBITOR) continue;

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

  // Generate reminders for previously sent outreach
  const reminderEntries = buildReminders(existingOutreach, events, today);

  const allNew = [...newEntries, ...reminderEntries];

  if (!allNew.length) {
    log.info('Outreach: 新規対象なし');
    return 0;
  }

  // Write to Sheets
  await storage.appendRows('outreach', allNew);
  log.info(`Outreach: ${newEntries.length}件の新規 + ${reminderEntries.length}件のリマインダーを追加`);
  return allNew.length;
}

/**
 * リマインダー生成
 * 条件: 1回目送信済み && 14日以上経過 && イベント開催日まで3〜7日
 */
function buildReminders(existingOutreach, events, today) {
  const eventMap = new Map();
  for (const e of events) {
    eventMap.set(e.id, e);
  }

  // Already has a reminder for this event+exhibitor?
  const reminderKeys = new Set(
    existingOutreach
      .filter((o) => o.status === 'reminder_pending' || o.status === 'reminder_sent')
      .map((o) => `${o.exhibitorId}__${o.eventId}`)
  );

  const reminders = [];
  const cooldownMs = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

  for (const o of existingOutreach) {
    if (o.status !== 'sent' || !o.sentAt) continue;

    const event = eventMap.get(o.eventId);
    if (!event || !event.date) continue;

    const eventDate = new Date(event.date);
    const daysUntilEvent = Math.floor((eventDate - today) / (24 * 60 * 60 * 1000));

    // Event must be 3-7 days away
    if (daysUntilEvent < 3 || daysUntilEvent > 7) continue;

    // Must be 14+ days since first DM
    const sentDate = new Date(o.sentAt);
    if (today - sentDate < cooldownMs) continue;

    // No duplicate reminders
    const key = `${o.exhibitorId}__${o.eventId}`;
    if (reminderKeys.has(key)) continue;

    reminders.push({
      outreachId: `otr_${randomUUID().slice(0, 8)}`,
      exhibitorId: o.exhibitorId,
      exhibitorName: o.exhibitorName,
      instagram: o.instagram,
      eventId: o.eventId,
      eventTitle: o.eventTitle,
      eventDate: o.eventDate,
      pageUrl: o.pageUrl,
      message: `【リマインダー】${o.exhibitorName}さん宛 / ${o.eventTitle}`,
      status: 'reminder_pending',
      sentAt: '',
      createdAt: new Date().toISOString(),
    });

    reminderKeys.add(key);
  }

  return reminders;
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
