import { readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

const expandPath = (p) => p.replace(/^~/, homedir());

let cachedToken = null;
let tokenExpiry = 0;

export async function getAccessToken(config) {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const credsPath = expandPath(config.google.credentialsPath);
  const tokenPath = expandPath(config.google.tokenPath);

  const creds = JSON.parse(readFileSync(credsPath, 'utf-8'));
  const clientConfig = creds.installed || creds.web;
  const tokenData = JSON.parse(readFileSync(tokenPath, 'utf-8'));

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientConfig.client_id,
      client_secret: clientConfig.client_secret,
      refresh_token: tokenData.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  // Expire 5 minutes early to be safe
  tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;
  return cachedToken;
}
