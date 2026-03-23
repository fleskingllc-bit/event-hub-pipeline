import { writeFileSync, readFileSync, copyFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { log } from '../lib/logger.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const OUTPUT_PATH = join(ROOT, 'output', 'data.json');
const IMAGE_LINKS_PATH = join(ROOT, 'data', 'image-links.json');

/**
 * Export approved events from Sheets to data.json
 */
export async function exportToJson(storage, config) {
  log.info('=== Exporting approved events to JSON ===');

  // Read events and exhibitors from Sheets
  const events = await storage.readAll('events');
  const exhibitors = await storage.readAll('exhibitors');

  // Filter approved only
  const approvedEvents = events.filter((e) => e.status === 'approved');
  const approvedExhibitors = exhibitors.filter((e) => e.status === 'approved');

  // Load image links if available
  let imageLinks = {};
  try {
    if (existsSync(IMAGE_LINKS_PATH)) {
      imageLinks = JSON.parse(readFileSync(IMAGE_LINKS_PATH, 'utf-8'));
      log.info(`Loaded image links for ${Object.keys(imageLinks).length} events`);
    }
  } catch { /* ignore */ }

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
    exhibitorIds: e.exhibitorIds ? JSON.parse(e.exhibitorIds) : [],
    imageCount: parseInt(e.imageCount) || 0,
    imageUrls: imageLinks[e.id] || [],
    source: e.source,
    sourceUrl: e.sourceUrl,
  }));

  // Transform exhibitors to UI format
  const uiExhibitors = approvedExhibitors.map((e) => ({
    id: e.id,
    name: e.name,
    category: e.category,
    categoryTag: e.categoryTag,
    instagram: e.instagram,
    description: e.description,
    menu: e.menu ? JSON.parse(e.menu) : [],
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
