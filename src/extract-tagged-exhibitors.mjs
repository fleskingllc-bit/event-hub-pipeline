#!/usr/bin/env node
/**
 * extract-tagged-exhibitors.mjs
 *
 * Instagram投稿の taggedUsers からイベント出店者を抽出し、
 * data.json の exhibitors に追加＆events に紐付ける。
 *
 * taggedUsers = 投稿画像にタグ付けされたアカウント
 * → マルシェ投稿では出店者がタグ付けされていることが多い
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PROTO = join(homedir(), 'event-hub-prototype', 'public');
const DATA_PATH = join(PROTO, 'data.json');
const RAW_DIR = join(homedir(), 'event-hub-pipeline', 'data', 'raw', 'instagram');

const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));

// Build postId → event map
const postToEvent = new Map();
for (const ev of data.events) {
  if (!ev.sourceUrl) continue;
  const m = ev.sourceUrl.match(/\/p\/([^/]+)/);
  if (m) postToEvent.set(m[1], ev);
}

// Build existing exhibitor lookup by instagram handle
const existingByHandle = new Map();
for (const ex of data.exhibitors) {
  if (ex.instagram) {
    const handle = ex.instagram.replace(/^@/, '').toLowerCase();
    if (handle) existingByHandle.set(handle, ex);
  }
}

// Accounts to skip (event organizer accounts, not exhibitors)
const SKIP_ACCOUNTS = new Set([
  // Add known organizer/venue accounts
]);

// Detect organizer: if the tagged username === post owner, skip
function isOrganizer(username, ownerUsername) {
  return username.toLowerCase() === (ownerUsername || '').toLowerCase();
}

let newExhibitors = 0;
let newLinks = 0;
let maxExhId = 0;

// Find max existing exhibitor ID number
for (const ex of data.exhibitors) {
  const m = ex.id.match(/(\d+)$/);
  if (m) maxExhId = Math.max(maxExhId, parseInt(m[0]));
}

function nextExhId() {
  maxExhId++;
  return `exh_tagged_${String(maxExhId).padStart(4, '0')}`;
}

// Process each raw Instagram file
const files = readdirSync(RAW_DIR).filter(f => f.endsWith('.json'));

for (const file of files) {
  const postId = file.replace('.json', '');
  const event = postToEvent.get(postId);
  if (!event) continue;

  const raw = JSON.parse(readFileSync(join(RAW_DIR, file), 'utf-8'));
  const rawData = raw.raw || raw;
  const ownerUsername = rawData.ownerUsername || '';

  // Collect all taggedUsers from main post and carousel children
  const allTags = [];
  if (rawData.taggedUsers?.length) allTags.push(...rawData.taggedUsers);
  if (rawData.childPosts) {
    for (const cp of rawData.childPosts) {
      if (cp.taggedUsers?.length) allTags.push(...cp.taggedUsers);
    }
  }

  // Dedupe by username
  const unique = [...new Map(allTags.map(t => [t.username, t])).values()];
  if (unique.length === 0) continue;

  const eventExIds = event.exhibitorIds || [];
  let updated = false;

  for (const tag of unique) {
    const handle = tag.username.toLowerCase();

    // Skip organizer account
    if (isOrganizer(handle, ownerUsername)) continue;
    if (SKIP_ACCOUNTS.has(handle)) continue;

    // Check if already linked to this event
    const existing = existingByHandle.get(handle);
    if (existing) {
      // Already exists — just link to event if not already
      if (!eventExIds.includes(existing.id)) {
        eventExIds.push(existing.id);
        newLinks++;
        updated = true;
        console.log(`  Link: ${event.title} ← ${existing.name} (@${handle})`);
      }
    } else {
      // Create new exhibitor from taggedUsers profile
      const newEx = {
        id: nextExhId(),
        name: cleanName(tag.full_name, handle),
        category: '',
        categoryTag: '',
        instagram: `@${tag.username}`,
        description: '',
        menu: [],
        profileImage: tag.profile_pic_url || '',
        status: 'pending_review',
        createdAt: new Date().toISOString(),
      };

      data.exhibitors.push(newEx);
      existingByHandle.set(handle, newEx);
      eventExIds.push(newEx.id);
      newExhibitors++;
      newLinks++;
      updated = true;
      console.log(`  New: ${newEx.name} (@${handle}) → ${event.title}`);
    }
  }

  if (updated) {
    event.exhibitorIds = eventExIds;
  }
}

/**
 * Clean up full_name for display as exhibitor name.
 * Instagram full_name often includes extra info like location, emoji, etc.
 */
function cleanName(fullName, username) {
  if (!fullName || fullName.trim() === '') {
    // Fallback to username
    return username;
  }
  let name = fullName.trim();
  // Remove common suffixes like /location descriptions
  // Keep first meaningful part before /
  const slashParts = name.split('/');
  if (slashParts.length > 1 && slashParts[0].trim().length >= 2) {
    name = slashParts[0].trim();
  }
  return name;
}

console.log(`\nNew exhibitors created: ${newExhibitors}`);
console.log(`New links added: ${newLinks}`);
console.log(`Total exhibitors: ${data.exhibitors.length}`);

writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
console.log(`Updated ${DATA_PATH}`);
