import { ApifyClient } from 'apify-client';
import { log } from '../lib/logger.js';
import { isProcessed, markProcessed } from '../lib/state.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('../../', import.meta.url).pathname;
const RAW_DIR = join(ROOT, 'data', 'raw', 'instagram');
mkdirSync(RAW_DIR, { recursive: true });

/**
 * Scrape Instagram posts via Apify
 */
export async function scrapeInstagram(config) {
  if (!config.apify?.apiToken) {
    log.warn('Apify API token not configured, skipping Instagram scraping');
    return [];
  }

  log.info('=== Scraping Instagram via Apify ===');
  const client = new ApifyClient({ token: config.apify.apiToken });

  const results = [];

  // 1. Hashtag scraping
  for (const hashtag of config.instagram.hashtags) {
    try {
      log.info(`Scraping hashtag: #${hashtag}`);
      const posts = await scrapeHashtag(client, hashtag);
      results.push(...posts);
    } catch (err) {
      log.error(`Hashtag #${hashtag} failed: ${err.message}`);
    }
  }

  // 2. Profile scraping
  for (const account of config.instagram.accounts) {
    try {
      log.info(`Scraping profile: @${account}`);
      const posts = await scrapeProfile(client, account);
      results.push(...posts);
    } catch (err) {
      log.error(`Profile @${account} failed: ${err.message}`);
    }
  }

  log.info(`Instagram: ${results.length} new posts collected`);
  return results;
}

async function scrapeHashtag(client, hashtag) {
  const run = await client.actor('apify/instagram-hashtag-scraper').call({
    hashtags: [hashtag],
    resultsLimit: 50,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return processItems(items, `hashtag_${hashtag}`);
}

async function scrapeProfile(client, username) {
  const run = await client.actor('apify/instagram-profile-scraper').call({
    usernames: [username],
    resultsLimit: 30,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return processItems(items, `profile_${username}`);
}

function processItems(items, sourceTag) {
  const results = [];

  for (const item of items) {
    const postId = item.id || item.shortCode || item.url?.split('/')?.slice(-2)?.[0];
    if (!postId) continue;

    if (isProcessed('instagram', postId)) {
      continue;
    }

    const post = {
      postId,
      accountName: item.ownerUsername || item.owner?.username || '',
      caption: item.caption || '',
      timestamp: item.timestamp || item.takenAtTimestamp || '',
      hashtags: extractHashtags(item.caption || ''),
      imageUrls: extractImageUrls(item),
      likesCount: item.likesCount || 0,
      sourceTag,
      source: 'instagram',
    };

    // Save raw
    writeFileSync(
      join(RAW_DIR, `${postId}.json`),
      JSON.stringify({ raw: item, processed: post }, null, 2)
    );

    results.push(post);
    markProcessed('instagram', postId);
  }

  return results;
}

function extractHashtags(caption) {
  const matches = caption.match(/#[\w\u3000-\u9fff\uf900-\ufaff]+/g) || [];
  return matches.map((h) => h.replace('#', ''));
}

function extractImageUrls(item) {
  if (item.displayUrl) return [item.displayUrl];
  if (item.images) return item.images.map((i) => i.url || i);
  if (item.childPosts) return item.childPosts.map((p) => p.displayUrl).filter(Boolean);
  return [];
}
