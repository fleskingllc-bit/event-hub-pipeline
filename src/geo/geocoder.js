import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { log } from '../lib/logger.js';
import { createRateLimiter } from '../lib/rate-limiter.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const CACHE_PATH = join(ROOT, 'data', 'geocache.json');

// Nominatim: max 1 request/sec
const rateLimiter = createRateLimiter(1100);

function loadCache() {
  if (!existsSync(CACHE_PATH)) return {};
  return JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
}

function saveCache(cache) {
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

/**
 * Geocode an address to lat/lng using Nominatim (free, 1req/sec)
 */
export async function geocode(address) {
  if (!address) return null;

  const cache = loadCache();
  if (cache[address]) {
    return cache[address];
  }

  await rateLimiter();

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&countrycodes=jp&limit=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'EventHubPipeline/1.0 (event collection for local community)',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      log.warn(`Nominatim ${res.status} for "${address}"`);
      return null;
    }

    const data = await res.json();
    if (!data.length) {
      log.warn(`No geocode result for "${address}"`);
      // Cache the miss to avoid retrying
      cache[address] = null;
      saveCache(cache);
      return null;
    }

    const result = {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      displayName: data[0].display_name,
    };

    cache[address] = result;
    saveCache(cache);
    log.debug(`Geocoded: "${address}" → ${result.lat}, ${result.lng}`);
    return result;
  } catch (err) {
    log.error(`Geocode error for "${address}": ${err.message}`);
    return null;
  }
}
