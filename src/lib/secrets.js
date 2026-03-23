/**
 * Secrets management — separated from config for portability.
 *
 * Priority: environment variable > secrets file > config.json (fallback)
 *
 * For deployment/sale: only this file needs updating to switch
 * from file-based to env-var or secret manager.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const ROOT = new URL('../../', import.meta.url).pathname;
const SECRETS_PATH = join(ROOT, 'secrets.json');

let _secrets = null;

function loadSecretsFile() {
  if (_secrets) return _secrets;
  if (existsSync(SECRETS_PATH)) {
    _secrets = JSON.parse(readFileSync(SECRETS_PATH, 'utf-8'));
  } else {
    _secrets = {};
  }
  return _secrets;
}

export function getSecret(key, fallback = '') {
  // 1. Environment variable (UPPER_SNAKE_CASE)
  const envKey = key.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '');
  if (process.env[envKey]) return process.env[envKey];

  // 2. secrets.json file
  const secrets = loadSecretsFile();
  if (secrets[key]) return secrets[key];

  // 3. Fallback
  return fallback;
}

export function getGoogleCredentialsPath() {
  return getSecret('googleCredentialsPath',
    join(homedir(), '.config', 'google-api', 'credentials.json'));
}

export function getGoogleTokenPath() {
  return getSecret('googleTokenPath',
    join(homedir(), '.config', 'google-api', 'token.json'));
}
