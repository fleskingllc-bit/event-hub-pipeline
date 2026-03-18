import { log } from '../lib/logger.js';

/**
 * Gemini Flash API client with retry logic.
 * Based on ~/meishi-ocr/meishi_auto.py pattern, adapted to Node.js fetch().
 */
export class GeminiClient {
  constructor(config) {
    this.apiKey = config.gemini.apiKey;
    this.model = config.gemini.model || 'gemini-2.0-flash';
    this.baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    this.maxRetries = config.scraping?.maxRetries || 3;
  }

  async generateContent(prompt, { temperature = 0.1 } = {}) {
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature,
        responseMimeType: 'application/json',
      },
    };

    return this._request(payload);
  }

  async _request(payload) {
    let lastError = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await fetch(this.baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(60000),
        });

        if (res.ok) {
          const data = await res.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (!text) return { error: 'Empty response from Gemini' };

          // Strip markdown code blocks if present
          let cleaned = text;
          if (cleaned.startsWith('```')) {
            cleaned = cleaned.split('\n').slice(1).join('\n');
            cleaned = cleaned.replace(/```\s*$/, '').trim();
          }

          try {
            return JSON.parse(cleaned);
          } catch {
            return { error: `JSON parse failed`, raw: cleaned };
          }
        }

        // Retryable errors
        if ([429, 500, 503].includes(res.status) && attempt < this.maxRetries) {
          const wait = 3000 * (attempt + 1);
          log.warn(`Gemini ${res.status}, retrying in ${wait / 1000}s...`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }

        return { error: `Gemini API ${res.status}: ${await res.text()}` };
      } catch (err) {
        lastError = err;
        if (attempt < this.maxRetries) {
          log.warn(`Gemini request error, retrying: ${err.message}`);
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
      }
    }

    return { error: `Gemini request failed: ${lastError?.message}` };
  }
}
