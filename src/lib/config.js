import { readFileSync } from 'fs';
import { join } from 'path';
import { getSecret, getGoogleCredentialsPath, getGoogleTokenPath } from './secrets.js';

const ROOT = new URL('../../', import.meta.url).pathname;

let _config = null;

export function loadConfig() {
  if (_config) return _config;
  const raw = readFileSync(join(ROOT, 'config.json'), 'utf-8');
  const base = JSON.parse(raw);

  // Merge secrets into config (secrets.js handles env vars / secrets.json)
  _config = {
    ...base,
    google: {
      ...base.google,
      credentialsPath: getGoogleCredentialsPath(),
      tokenPath: getGoogleTokenPath(),
    },
    gemini: {
      ...base.gemini,
      apiKey: getSecret('geminiApiKey'),
    },
    apify: {
      apiToken: getSecret('apifyApiToken'),
    },
  };
  return _config;
}
