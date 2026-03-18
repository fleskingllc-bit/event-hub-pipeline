import { GeminiClient } from './gemini.js';
import { EVENT_DETECTION_PROMPT } from './prompts.js';
import { log } from '../lib/logger.js';

/**
 * Detect if an Instagram post is an event announcement
 */
export async function detectEvent(caption, config) {
  const gemini = new GeminiClient(config);
  const prompt = EVENT_DETECTION_PROMPT(caption);
  const result = await gemini.generateContent(prompt);

  if (result.error) {
    log.warn(`Event detection failed: ${result.error}`);
    return { is_event: false, confidence: 'low', event_type: 'その他', reason: 'API error' };
  }

  return result;
}
