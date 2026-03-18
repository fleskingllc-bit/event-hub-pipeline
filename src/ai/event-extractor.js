import { GeminiClient } from './gemini.js';
import { SITE_EXTRACTION_PROMPT, EVENT_EXTRACTION_PROMPT } from './prompts.js';
import { log } from '../lib/logger.js';
import { createRateLimiter } from '../lib/rate-limiter.js';

const geminiLimiter = createRateLimiter(1500); // Gemini free tier: ~15 RPM

/**
 * Extract structured event data from site scraping results
 */
export async function extractFromSiteData(rawEvents, config) {
  const gemini = new GeminiClient(config);
  const results = [];

  for (const raw of rawEvents) {
    await geminiLimiter();

    try {
      const prompt = SITE_EXTRACTION_PROMPT(raw, raw.source || 'まいぷれ');
      const structured = await gemini.generateContent(prompt);

      if (structured.error) {
        log.error(`Gemini extraction error for "${raw.title}": ${structured.error}`);
        // Fallback: use raw data directly
        results.push(buildFallbackEvent(raw));
        continue;
      }

      results.push({
        ...structured,
        // Preserve source info from raw
        sourceId: raw.sourceId,
        source: raw.source,
        sourceUrl: raw.sourceUrl,
        images: raw.images || [],
        fee: structured.fee || raw.fee || '',
        exhibitors: structured.exhibitors || [],
      });

      log.info(`Extracted: ${structured.title || raw.title}`);
    } catch (err) {
      log.error(`Extraction failed for "${raw.title}": ${err.message}`);
      results.push(buildFallbackEvent(raw));
    }
  }

  return results;
}

/**
 * Extract structured event data from Instagram captions
 */
export async function extractFromCaption(caption, config) {
  const gemini = new GeminiClient(config);
  const prompt = EVENT_EXTRACTION_PROMPT(caption, 'Instagram投稿');
  return gemini.generateContent(prompt);
}

/**
 * Build a fallback event from raw data when Gemini fails
 */
function buildFallbackEvent(raw) {
  return {
    title: raw.title || '',
    date: '',
    dateEnd: '',
    dayOfWeek: '',
    time: '',
    location: raw.locationName || '',
    address: raw.address || '',
    area: '',
    description: (raw.description || '').slice(0, 200),
    fee: raw.fee || '',
    sourceId: raw.sourceId,
    source: raw.source,
    sourceUrl: raw.sourceUrl,
    images: raw.images || [],
    exhibitors: [],
    _fallback: true,
  };
}
