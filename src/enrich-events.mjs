/**
 * Event Enrichment: Generate dynamic hashtags for web events without images.
 *
 * For events discovered via mypl/TRYangle that have no linked images,
 * generate Instagram hashtag candidates from event names and add them
 * to config.json for the next Apify scrape run.
 *
 * Budget-aware: max 20 dynamic hashtags to keep within Apify $5/month.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const PIPELINE_DIR = '/Users/flesking/event-hub-pipeline';
const PROTO_DIR = '/Users/flesking/event-hub-prototype';
const DATA_PATH = join(PROTO_DIR, 'public/data.json');
const LINKS_PATH = join(PIPELINE_DIR, 'data/image-links.json');
const CONFIG_PATH = join(PIPELINE_DIR, 'config.json');

const MAX_DYNAMIC_HASHTAGS = 20;

// Too generic to be useful as hashtags
const GENERIC_TAGS = new Set([
  'フリーマーケット', 'マルシェ', 'イベント', 'まつり', '祭り', '祭',
  'コンサート', 'ライブ', '展示会', '骨董市', '朝市',
]);

// City names alone are too broad
const CITY_NAMES = new Set([
  '周南市', '下松市', '光市', '山口市', '防府市', '下関市',
  '岩国市', '萩市', '長門市', '宇部市', '美祢市', '柳井市',
  '防府', '周南', '下松', '光', '山口', '下関', '岩国', '萩', '長門', '宇部', '美祢', '柳井',
]);

/**
 * Generate hashtag candidates from an event title.
 * Returns an array of hashtag strings (without #).
 */
function generateHashtags(title) {
  if (!title || title.length < 3) return [];

  const tags = new Set();

  // 1. Full event name as-is (remove spaces and common punctuation)
  const cleaned = title
    .replace(/[第\d]+回\s*/g, '')  // Remove 第N回
    .replace(/[\s　]+/g, '')        // Remove spaces
    .replace(/[「」【】()（）]/g, '') // Remove brackets
    .trim();
  if (cleaned.length >= 4 && cleaned.length <= 20) {
    tags.add(cleaned);
  }

  // 2. Try to extract core event name (before common suffixes)
  const suffixPattern = /^(.+?)(マルシェ|フェス|フェスタ|フェスティバル|まつり|祭り|祭|マーケット)$/;
  const suffixMatch = cleaned.match(suffixPattern);
  if (suffixMatch) {
    const core = suffixMatch[1];
    const suffix = suffixMatch[2];
    if (core.length >= 2 && (core + suffix).length <= 20) {
      tags.add(core + suffix);
    }
  }

  // 3. If title contains area + event type, create compact version
  const areaPattern = /^(周南|下松|光|山口|防府|下関|岩国|萩|長門|宇部|美祢|柳井|山陽小野田|くだまつ)/;
  const areaMatch = cleaned.match(areaPattern);
  if (areaMatch && suffixMatch) {
    const shortTag = areaMatch[1] + suffixMatch[2];
    if (shortTag !== cleaned && shortTag.length >= 4) {
      tags.add(shortTag);
    }
  }

  return [...tags];
}

/**
 * Filter out low-quality hashtag candidates.
 */
function isGoodHashtag(tag) {
  if (GENERIC_TAGS.has(tag)) return false;
  if (CITY_NAMES.has(tag)) return false;
  if (tag.length < 4 || tag.length > 20) return false;
  // Skip tags with year references to past years
  if (/202[0-5]/.test(tag)) return false;
  // Skip tags with special characters that won't work as hashtags
  if (/[/＆&～]/.test(tag)) return false;
  // Skip overly long descriptive names (likely not real hashtags)
  if (tag.length > 15 && !/(マルシェ|フェス|まつり|祭|マーケット)$/.test(tag)) return false;
  return true;
}

export async function enrichEvents() {
  // Load data
  const data = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
  const imageLinks = existsSync(LINKS_PATH)
    ? JSON.parse(readFileSync(LINKS_PATH, 'utf8'))
    : {};
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));

  // Only consider future events (from today onward)
  const today = new Date().toISOString().slice(0, 10);
  const siteEvents = data.events.filter(e => e.source !== 'instagram');
  const futureNoImage = siteEvents.filter(e =>
    !imageLinks[e.id]?.length && e.date && e.date >= today
  );

  console.log(`Future site events without images: ${futureNoImage.length}/${siteEvents.length}`);

  // Collect existing tags to avoid duplicates
  const existingTags = new Set([
    ...(config.instagram.hashtags || []),
    ...(config.instagram.dynamicHashtags || []),
  ]);
  if (config.instagram.rotation?.groups) {
    for (const group of Object.values(config.instagram.rotation.groups)) {
      for (const tag of (group.hashtags || [])) {
        existingTags.add(tag);
      }
    }
  }

  // Generate and filter hashtags
  const candidates = [];
  for (const ev of futureNoImage) {
    const tags = generateHashtags(ev.title);
    for (const tag of tags) {
      if (!existingTags.has(tag) && isGoodHashtag(tag)) {
        candidates.push({ tag, event: ev.title, date: ev.date });
      }
    }
  }

  // Deduplicate and sort by date (nearest future first)
  const uniqueTags = new Map();
  for (const c of candidates) {
    if (!uniqueTags.has(c.tag)) {
      uniqueTags.set(c.tag, c);
    }
  }

  const sorted = [...uniqueTags.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, MAX_DYNAMIC_HASHTAGS);

  if (sorted.length === 0) {
    console.log('No new hashtags to add.');
    return { added: 0 };
  }

  for (const c of sorted) {
    console.log(`  + #${c.tag} ← "${c.event}" (${c.date})`);
  }

  // Replace dynamic hashtags entirely (only keep current relevant ones)
  config.instagram.dynamicHashtags = sorted.map(c => c.tag);

  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log(`\nSet ${sorted.length} dynamic hashtags in config.json`);

  return { added: sorted.length, tags: sorted.map(c => c.tag) };
}

// Allow direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  enrichEvents().catch(err => {
    console.error('Enrichment failed:', err.message);
    process.exit(1);
  });
}
