#!/usr/bin/env node
/**
 * Batch approve all pending_review events and exhibitors in Sheets.
 * Usage: node src/approve-pending.mjs
 */
import { loadConfig } from './lib/config.js';
import { SheetsStorage } from './storage/sheets.js';
import { log } from './lib/logger.js';

const config = loadConfig();
const storage = new SheetsStorage(config);

// Events: status is column N (14th col)
const events = await storage.readAll('events');
let approvedCount = 0;
for (let i = 0; i < events.length; i++) {
  if (events[i].status === 'pending_review') {
    const rowNum = i + 2; // +1 for header, +1 for 1-indexed
    await storage.updateCell('events', rowNum, 'N', 'approved');
    approvedCount++;
  }
}
log.info(`Approved ${approvedCount} events`);

// Exhibitors: status is column H (8th col)
const exhibitors = await storage.readAll('exhibitors');
let exApproved = 0;
for (let i = 0; i < exhibitors.length; i++) {
  if (exhibitors[i].status === 'pending_review') {
    const rowNum = i + 2;
    await storage.updateCell('exhibitors', rowNum, 'H', 'approved');
    exApproved++;
  }
}
log.info(`Approved ${exApproved} exhibitors`);
