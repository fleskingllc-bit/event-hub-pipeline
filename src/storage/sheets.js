import { StorageInterface } from './interface.js';
import { getAccessToken } from '../lib/google-auth.js';
import { log } from '../lib/logger.js';

// Column headers for each sheet
const HEADERS = {
  events: [
    'id', 'title', 'date', 'dayOfWeek', 'time', 'location', 'address',
    'lat', 'lng', 'area', 'description', 'exhibitorIds', 'imageCount',
    'status', 'source', 'sourceUrl', 'createdAt',
  ],
  exhibitors: [
    'id', 'name', 'category', 'categoryTag', 'instagram', 'description',
    'menu', 'status', 'createdAt',
  ],
  instagram_posts: [
    'postId', 'accountName', 'caption', 'timestamp', 'hashtags', 'imageUrls',
    'isEventRelated', 'extractedEventId', 'processedAt',
  ],
  scrape_log: [
    'runId', 'source', 'startTime', 'endTime', 'newCount', 'errors', 'status',
  ],
  outreach: [
    'outreachId', 'exhibitorId', 'exhibitorName', 'instagram', 'eventId',
    'eventTitle', 'eventDate', 'pageUrl', 'message', 'status', 'sentAt', 'createdAt',
  ],
};

export class SheetsStorage extends StorageInterface {
  constructor(config) {
    super();
    this.config = config;
    this.spreadsheetId = config.google.spreadsheetId;
  }

  async _fetch(path, options = {}) {
    const token = await getAccessToken(this.config);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Sheets API ${res.status}: ${body}`);
    }
    return res.json();
  }

  async appendRows(sheet, rows) {
    if (!rows.length) return;
    const headers = HEADERS[sheet];
    const values = rows.map((row) =>
      headers.map((h) => {
        const v = row[h];
        if (v === undefined || v === null) return '';
        if (Array.isArray(v) || typeof v === 'object') return JSON.stringify(v);
        return String(v);
      })
    );

    const range = encodeURIComponent(`${sheet}!A:${String.fromCharCode(64 + headers.length)}`);
    const data = await this._fetch(
      `/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      { method: 'POST', body: JSON.stringify({ values }) }
    );
    log.info(`Appended ${rows.length} rows to ${sheet}`);
    return data;
  }

  async readAll(sheet) {
    const headers = HEADERS[sheet];
    const range = encodeURIComponent(`${sheet}!A:${String.fromCharCode(64 + headers.length)}`);
    const data = await this._fetch(`/values/${range}`);
    const rawRows = data.values || [];

    // Skip header row
    return rawRows.slice(1).map((row) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj;
    });
  }

  async updateCell(sheet, rowNum, col, value) {
    const range = encodeURIComponent(`${sheet}!${col}${rowNum}`);
    await this._fetch(
      `/values/${range}?valueInputOption=USER_ENTERED`,
      { method: 'PUT', body: JSON.stringify({ values: [[value]] }) }
    );
  }

  /**
   * Fill blank cells only — never overwrite existing values.
   * @param {string} sheet - Sheet name (e.g. 'events')
   * @param {string} idField - Column name used as row identifier (e.g. 'id')
   * @param {string} idValue - Value to match in idField
   * @param {object} fields - { columnName: value } to fill if currently empty
   * @returns {string[]} list of fields that were filled
   */
  async fillBlanks(sheet, idField, idValue, fields) {
    const headers = HEADERS[sheet];
    const rows = await this.readAll(sheet);
    const rowIndex = rows.findIndex((r) => r[idField] === idValue);
    if (rowIndex < 0) return [];

    const row = rows[rowIndex];
    const rowNum = rowIndex + 2; // +1 for header, +1 for 1-based
    const filled = [];

    for (const [col, value] of Object.entries(fields)) {
      if (!value && value !== 0) continue; // skip empty new values
      const existing = row[col];
      if (existing && existing.trim() !== '') continue; // already has value
      const colIndex = headers.indexOf(col);
      if (colIndex < 0) continue;
      const colLetter = String.fromCharCode(65 + colIndex);
      await this.updateCell(sheet, rowNum, colLetter, String(value));
      filled.push(col);
    }

    if (filled.length > 0) {
      log.info(`fillBlanks: ${idValue} filled [${filled.join(', ')}]`);
    }
    return filled;
  }

  /** Ensure a sheet tab exists; create it + write headers if missing */
  async ensureSheetExists(sheet) {
    const token = await getAccessToken(this.config);
    // Get existing sheet names
    const meta = await this._fetch('?fields=sheets.properties.title');
    const existing = (meta.sheets || []).map((s) => s.properties.title);
    if (existing.includes(sheet)) return;

    // Add the sheet
    await this._fetch(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: sheet } } }],
      }),
    });

    // Write headers
    const headers = HEADERS[sheet];
    if (headers) {
      const range = encodeURIComponent(`${sheet}!A1`);
      await this._fetch(`/values/${range}?valueInputOption=RAW`, {
        method: 'PUT',
        body: JSON.stringify({ values: [headers] }),
      });
    }
    log.info(`Created sheet tab: ${sheet}`);
  }

  /** Create the spreadsheet with all 4 sheets and headers */
  async initSpreadsheet() {
    const token = await getAccessToken(this.config);

    // Create spreadsheet
    const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: { title: 'イベント収集パイプライン' },
        sheets: Object.keys(HEADERS).map((name) => ({
          properties: { title: name },
        })),
      }),
    });

    if (!res.ok) throw new Error(`Create spreadsheet failed: ${await res.text()}`);
    const data = await res.json();
    const newId = data.spreadsheetId;
    log.info(`Created spreadsheet: ${newId}`);

    // Write headers to each sheet
    this.spreadsheetId = newId;
    for (const [sheet, headers] of Object.entries(HEADERS)) {
      const range = encodeURIComponent(`${sheet}!A1`);
      await this._fetch(
        `/values/${range}?valueInputOption=RAW`,
        { method: 'PUT', body: JSON.stringify({ values: [headers] }) }
      );
    }

    return newId;
  }
}

export { HEADERS };
