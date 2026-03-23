/**
 * Image linker v3:
 * 1. Scan existing local images to preserve all current links
 * 2. Build shortCode→raw post index
 * 3. For IG events: find the raw post, extract ALL carousel images, download new ones
 * 4. For site events: try to match to IG posts by title/date
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const PROTO_DIR = '/Users/flesking/event-hub-prototype';
const PIPELINE_DIR = '/Users/flesking/event-hub-pipeline';
const RAW_IG_DIR = join(PIPELINE_DIR, 'data/raw/instagram');
const IMAGE_DIR = join(PROTO_DIR, 'public/images/events');
const LINKS_PATH = join(PIPELINE_DIR, 'data/image-links.json');
const DATA_PATH = join(PROTO_DIR, 'public/data.json');

// ── 1. Scan existing local images ──
const existingFiles = readdirSync(IMAGE_DIR).filter(f => f.endsWith('.jpg'));
const existingLinks = {};
for (const f of existingFiles) {
  // Format: evt_HASH_NNN_IDX.jpg
  const match = f.match(/^(evt_[a-f0-9]+_\d+)_(\d+)\.jpg$/);
  if (match) {
    const eventId = match[1];
    if (!existingLinks[eventId]) existingLinks[eventId] = [];
    existingLinks[eventId].push(`/images/events/${f}`);
  }
}
// Sort each event's images by index
for (const id of Object.keys(existingLinks)) {
  existingLinks[id].sort();
}

console.log(`Existing local images: ${existingFiles.length} files for ${Object.keys(existingLinks).length} events`);

// ── 2. Load events ──
const data = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
const events = data.events;
const igEvents = events.filter(e => e.source === 'instagram');
const siteEvents = events.filter(e => e.source !== 'instagram');
console.log(`Events: ${events.length} (IG: ${igEvents.length}, Site: ${siteEvents.length})`);

// ── 3. Read all raw Instagram posts, build shortCode index ──
const rawFiles = readdirSync(RAW_IG_DIR).filter(f => f.endsWith('.json'));
const posts = [];
const postIdMap = new Map();

for (const f of rawFiles) {
  try {
    const d = JSON.parse(readFileSync(join(RAW_IG_DIR, f), 'utf8'));
    const raw = d.raw || {};
    const processed = d.processed || {};

    const allImages = [];
    if (raw.images && raw.images.length > 0) {
      for (const img of raw.images) {
        const url = typeof img === 'string' ? img : (img.url || img);
        if (url) allImages.push(url);
      }
    }
    if (allImages.length === 0 && raw.displayUrl) {
      allImages.push(raw.displayUrl);
    }

    const postId = String(raw.id || f.replace('.json', ''));
    const post = {
      postId,
      shortCode: raw.shortCode || '',
      caption: raw.caption || '',
      timestamp: raw.timestamp || '',
      accountName: processed.accountName || raw.ownerUsername || '',
      imageUrls: allImages,
    };
    posts.push(post);
    postIdMap.set(postId, post);
  } catch {}
}

console.log(`IG posts: ${posts.length}, postId index: ${postIdMap.size}`);
console.log(`Total IG images available: ${posts.reduce((s, p) => s + p.imageUrls.length, 0)}`);

// ── 4. For IG events: find carousel images ──
const finalLinks = { ...existingLinks };
let carouselExpanded = 0;
let newCarouselImages = 0;

for (const ev of igEvents) {
  // Find raw post by postId from sourceUrl
  const idMatch = ev.sourceUrl?.match(/instagram\.com\/p\/([^/?]+)/);
  let post = idMatch ? postIdMap.get(idMatch[1]) : null;

  // Fallback: match by title words in caption
  if (!post) {
    const words = ev.title.split(/[\s　・、。\-×]+/).filter(w => w.length >= 2);
    if (words.length >= 2) {
      for (const p of posts) {
        if (!p.caption) continue;
        const matched = words.filter(w => p.caption.includes(w)).length;
        if (matched >= Math.min(3, words.length)) { post = p; break; }
      }
    }
  }

  if (!post || post.imageUrls.length <= 1) continue;

  const currentCount = (finalLinks[ev.id] || []).length;
  if (post.imageUrls.length <= currentCount) continue;

  // We have more images to add! Download them.
  const newUrls = [...(finalLinks[ev.id] || [])];
  for (let i = currentCount; i < post.imageUrls.length; i++) {
    const filename = `${ev.id}_${i}.jpg`;
    const localPath = join(IMAGE_DIR, filename);
    const webPath = `/images/events/${filename}`;

    if (existsSync(localPath)) {
      newUrls.push(webPath);
      continue;
    }

    try {
      const res = await fetch(post.imageUrls[i], { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());
        writeFileSync(localPath, buffer);
        newUrls.push(webPath);
        newCarouselImages++;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 80));
  }

  if (newUrls.length > currentCount) {
    finalLinks[ev.id] = newUrls;
    carouselExpanded++;
  }
}

console.log(`\nCarousel expansion: ${carouselExpanded} events, +${newCarouselImages} new images downloaded`);

// ── 5. Match site events to IG posts ──
let siteMatched = 0;
for (const ev of siteEvents) {
  if (finalLinks[ev.id]?.length > 0) continue; // already has images
  if (!ev.title || ev.title.length < 3) continue;

  const titleWords = ev.title.split(/[\s　・、。\-×「」【】()（）]+/).filter(w => w.length >= 2);
  if (titleWords.length === 0) continue;

  const evDate = ev.date ? new Date(ev.date) : null;

  let bestMatch = null;
  let bestScore = 0;

  for (const post of posts) {
    if (!post.caption || post.imageUrls.length === 0) continue;
    let score = 0;
    const matched = titleWords.filter(w => post.caption.includes(w));
    score += matched.length * 2;

    // Date boost
    if (evDate) {
      const m = evDate.getMonth() + 1, d = evDate.getDate();
      if (post.caption.includes(`${m}/${d}`) || post.caption.includes(`${m}月${d}日`)) score += 2;
    }

    // Location boost
    if (ev.location) {
      const locWords = ev.location.split(/[\s　]+/).filter(w => w.length >= 2);
      if (locWords.some(w => post.caption.includes(w))) score += 2;
    }

    if (matched.length >= 2 && score > bestScore) {
      bestScore = score;
      bestMatch = post;
    }
  }

  if (bestMatch && bestScore >= 5) {
    // Download images for this site event
    const urls = [];
    for (let i = 0; i < bestMatch.imageUrls.length; i++) {
      const filename = `${ev.id}_${i}.jpg`;
      const localPath = join(IMAGE_DIR, filename);
      const webPath = `/images/events/${filename}`;

      if (existsSync(localPath)) { urls.push(webPath); continue; }

      try {
        const res = await fetch(bestMatch.imageUrls[i], { signal: AbortSignal.timeout(15000) });
        if (res.ok) {
          const buffer = Buffer.from(await res.arrayBuffer());
          writeFileSync(localPath, buffer);
          urls.push(webPath);
        }
      } catch {}
      await new Promise(r => setTimeout(r, 80));
    }
    if (urls.length > 0) {
      finalLinks[ev.id] = urls;
      siteMatched++;
      console.log(`  ✓ "${ev.title}" → @${bestMatch.accountName} (score:${bestScore}, ${urls.length} imgs)`);
    }
  }
}

console.log(`\nSite events matched: ${siteMatched}/${siteEvents.length}`);

// ── 6. Summary & save ──
const totalEvents = Object.keys(finalLinks).length;
const totalImages = Object.values(finalLinks).reduce((s, a) => s + a.length, 0);
console.log(`\n=== Final ===`);
console.log(`Events with images: ${totalEvents}/${events.length}`);
console.log(`Total images: ${totalImages}`);
console.log(`Average images per event: ${(totalImages / totalEvents).toFixed(1)}`);

writeFileSync(LINKS_PATH, JSON.stringify(finalLinks, null, 2));
console.log('Saved image-links.json');
