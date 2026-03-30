import { writeFileSync, readFileSync, copyFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { log } from '../lib/logger.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const OUTPUT_PATH = join(ROOT, 'output', 'data.json');
const IMAGE_LINKS_PATH = join(ROOT, 'data', 'image-links.json');
const MASTER_DB_PATH = join(ROOT, 'data', 'exhibitor-master.json');

/**
 * Export approved events from Sheets to data.json
 * Exhibitors are sourced from master DB (primary) with Sheets as fallback.
 */
export async function exportToJson(storage, config) {
  log.info('=== Exporting approved events to JSON ===');

  // Read events from Sheets
  const events = await storage.readAll('events');
  // Date window: past events excluded, future capped at 3 months
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const approvedEvents = events.filter((e) => e.status === 'approved' && e.date >= today && e.date <= cutoff);
  log.info(`Date filter: ${today} ~ ${cutoff} → ${approvedEvents.length}/${events.filter(e => e.status === 'approved').length} approved events`);

  // Load exhibitors from master DB (primary source)
  let uiExhibitors = [];
  if (existsSync(MASTER_DB_PATH)) {
    const masterDB = JSON.parse(readFileSync(MASTER_DB_PATH, 'utf-8'));
    uiExhibitors = masterDB.exhibitors.map((e) => ({
      id: e.id,
      name: e.name,
      category: e.category || 'その他',
      categoryTag: e.category || 'その他',
      instagram: e.instagram || '',
      description: e.description || '',
      menu: Array.isArray(e.menu) ? e.menu : [],
    }));
    log.info(`Loaded ${uiExhibitors.length} exhibitors from master DB`);
  } else {
    // Fallback: read from Sheets
    log.warn('Master DB not found, falling back to Sheets exhibitors');
    const exhibitors = await storage.readAll('exhibitors');
    const approvedExhibitors = exhibitors.filter((e) => e.status === 'approved');
    uiExhibitors = approvedExhibitors.map((e) => ({
      id: e.id,
      name: e.name,
      category: e.category,
      categoryTag: e.categoryTag,
      instagram: e.instagram,
      description: e.description,
      menu: e.menu ? JSON.parse(e.menu) : [],
    }));
  }

  // Load image links if available
  let imageLinks = {};
  try {
    if (existsSync(IMAGE_LINKS_PATH)) {
      imageLinks = JSON.parse(readFileSync(IMAGE_LINKS_PATH, 'utf-8'));
      log.info(`Loaded image links for ${Object.keys(imageLinks).length} events`);
    }
  } catch { /* ignore */ }

  // Validate coordinates — flag events outside Yamaguchi bounds
  const YG = { latMin: 33.7, latMax: 34.55, lngMin: 130.7, lngMax: 132.4 };
  for (const e of approvedEvents) {
    if (!e.lat || !e.lng) continue;
    const lat = parseFloat(e.lat);
    const lng = parseFloat(e.lng);
    if (lat < YG.latMin || lat > YG.latMax || lng < YG.lngMin || lng > YG.lngMax) {
      log.warn(`⚠ ${e.id} "${e.title}" has coords outside Yamaguchi: (${lat}, ${lng})`);
    }
  }

  // Build exhibitor ID set for quick lookup
  const masterIdSet = new Set(uiExhibitors.map(e => e.id));

  // Transform events to UI format
  const uiEvents = approvedEvents.map((e) => ({
    id: e.id,
    title: e.title,
    date: e.date,
    dayOfWeek: e.dayOfWeek,
    time: e.time,
    location: e.location,
    address: e.address,
    lat: e.lat ? parseFloat(e.lat) : null,
    lng: e.lng ? parseFloat(e.lng) : null,
    area: e.area,
    description: e.description,
    exhibitorIds: (e.exhibitorIds ? JSON.parse(e.exhibitorIds) : [])
      .filter(id => masterIdSet.has(id)),
    imageCount: parseInt(e.imageCount) || 0,
    imageUrls: imageLinks[e.id] || [],
    source: e.source,
    sourceUrl: e.sourceUrl,
  }));

  const output = {
    events: uiEvents,
    exhibitors: uiExhibitors,
    exportedAt: new Date().toISOString(),
    totalEvents: uiEvents.length,
    totalExhibitors: uiExhibitors.length,
  };

  // Write to output/data.json
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  log.info(`Exported ${uiEvents.length} events, ${uiExhibitors.length} exhibitors to ${OUTPUT_PATH}`);

  // Copy to prototype if configured
  const prototypePath = config.output?.prototypeDataPath?.replace(/^~/, homedir());
  if (prototypePath && existsSync(dirname(prototypePath))) {
    copyFileSync(OUTPUT_PATH, prototypePath);
    log.info(`Copied to prototype: ${prototypePath}`);
  }

  return output;
}
