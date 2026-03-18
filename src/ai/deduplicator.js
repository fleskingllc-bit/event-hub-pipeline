import { GeminiClient } from './gemini.js';
import { DEDUP_PROMPT } from './prompts.js';
import { log } from '../lib/logger.js';
import { createRateLimiter } from '../lib/rate-limiter.js';

const geminiLimiter = createRateLimiter(1500);

/**
 * Quick check if two events might be duplicates (before calling Gemini)
 */
function quickDupCheck(a, b) {
  // Same date + similar title → candidate
  if (a.date && b.date && a.date === b.date) {
    const titleA = (a.title || '').replace(/\s/g, '');
    const titleB = (b.title || '').replace(/\s/g, '');
    if (titleA === titleB) return true;
    // Check for substring match (>50% overlap)
    const shorter = titleA.length < titleB.length ? titleA : titleB;
    const longer = titleA.length >= titleB.length ? titleA : titleB;
    if (shorter.length > 3 && longer.includes(shorter)) return true;
  }
  return false;
}

/**
 * Deduplicate events across sources
 */
export async function deduplicateEvents(events, config) {
  if (events.length < 2) return events;

  const merged = [...events];
  const toRemove = new Set();

  for (let i = 0; i < merged.length; i++) {
    if (toRemove.has(i)) continue;

    for (let j = i + 1; j < merged.length; j++) {
      if (toRemove.has(j)) continue;

      if (!quickDupCheck(merged[i], merged[j])) continue;

      // Potential duplicate — ask Gemini for confirmation
      await geminiLimiter();
      const gemini = new GeminiClient(config);
      const result = await gemini.generateContent(DEDUP_PROMPT(merged[i], merged[j]));

      if (result.is_duplicate && result.confidence !== 'low') {
        log.info(`Duplicate found: "${merged[i].title}" ≈ "${merged[j].title}"`);
        if (result.merged) {
          // Keep merged version, preserve source info from both
          merged[i] = {
            ...result.merged,
            sourceId: merged[i].sourceId,
            source: merged[i].source,
            sourceUrl: merged[i].sourceUrl,
            images: [...(merged[i].images || []), ...(merged[j].images || [])],
          };
        }
        toRemove.add(j);
      }
    }
  }

  return merged.filter((_, i) => !toRemove.has(i));
}
