#!/usr/bin/env node
/**
 * upscale-hero.mjs — 既存ヒーロー画像をGemini multimodalで高解像度化
 * Usage: node src/upscale-hero.mjs <eventId>
 *
 * インポートして使う場合:
 *   import { upscaleHeroIfNeeded } from './upscale-hero.mjs';
 *   await upscaleHeroIfNeeded(eventId); // 低解像度なら自動で高解像度化
 */
import { readFileSync, writeFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const ROOT = new URL('../', import.meta.url).pathname;
const HERO_DIR = join(ROOT, '..', 'event-hub-prototype', 'public', 'images', 'heroes');
const MIN_WIDTH = 1000; // これ未満を低解像度と判定

/**
 * ヒーロー画像の横幅をpx単位で取得
 */
function getImageWidth(filePath) {
  try {
    const out = execSync(`sips -g pixelWidth "${filePath}" 2>/dev/null`, { encoding: 'utf-8' });
    const m = out.match(/pixelWidth:\s*(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  } catch { return 0; }
}

/**
 * Gemini multimodalでヒーロー画像を高解像度化
 */
export async function upscaleHero(eventId) {
  const secrets = JSON.parse(readFileSync(join(ROOT, 'secrets.json'), 'utf-8'));
  const apiKey = secrets.geminiApiKey;

  const heroPath = join(HERO_DIR, `${eventId}.webp`);
  const heroData = readFileSync(heroPath).toString('base64');
  const origSize = statSync(heroPath).size;

  console.log(`📸 高解像度化: ${eventId} (元サイズ: ${origSize} bytes)`);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{
      parts: [
        { inlineData: { mimeType: 'image/webp', data: heroData } },
        { text: 'Recreate this exact same illustration at higher quality and detail. Keep the exact same composition, objects, colors, style, and layout. Just make it sharper, more detailed, and higher fidelity. Same white background. NO TEXT. No people, no faces, no hands.' }
      ]
    }],
    generationConfig: {
      responseModalities: ['image', 'text'],
      imageConfig: { aspectRatio: '16:9' },
    },
  };

  console.log('Gemini APIに送信中...');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${text.slice(0, 300)}`);
  }

  const result = await res.json();
  const parts = result.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
  if (!imgPart) {
    throw new Error('Gemini: 画像が返されませんでした');
  }

  writeFileSync(heroPath, Buffer.from(imgPart.inlineData.data, 'base64'));
  const newSize = statSync(heroPath).size;
  console.log(`✅ 高解像度化完了: ${heroPath}`);
  console.log(`   ${origSize} bytes → ${newSize} bytes`);
  return heroPath;
}

/**
 * ヒーロー画像が低解像度（幅<1000px）なら自動で高解像度化
 * @returns {boolean} 高解像度化を実行したかどうか
 */
export async function upscaleHeroIfNeeded(eventId) {
  const heroPath = join(HERO_DIR, `${eventId}.webp`);
  if (!existsSync(heroPath)) return false;

  const width = getImageWidth(heroPath);
  if (width >= MIN_WIDTH) {
    return false; // 既に高解像度
  }

  console.log(`⚠️  ヒーロー画像が低解像度 (${width}px) → 高解像度化します`);
  await upscaleHero(eventId);
  return true;
}

// Direct execution
const scriptName = process.argv[1] || '';
if (scriptName.endsWith('upscale-hero.mjs')) {
  const eventId = process.argv[2];
  if (!eventId) {
    console.error('Usage: node src/upscale-hero.mjs <eventId>');
    process.exit(1);
  }

  const heroPath = join(HERO_DIR, `${eventId}.webp`);
  if (!existsSync(heroPath)) {
    console.error(`ヒーロー画像が見つかりません: ${heroPath}`);
    process.exit(1);
  }

  const width = getImageWidth(heroPath);
  console.log(`現在の幅: ${width}px`);

  if (width >= MIN_WIDTH) {
    console.log('既に高解像度です。--force で強制実行できます。');
    if (!process.argv.includes('--force')) process.exit(0);
  }

  await upscaleHero(eventId);
}
