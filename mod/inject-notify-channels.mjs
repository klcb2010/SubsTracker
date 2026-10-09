#!/usr/bin/env node
/**
 * 注入 mod/assets → 源码（含：渠道、精简文案、一次性定时提醒）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const assets = path.join(__dirname, 'assets');

/** [assetName, targetRel, createIfMissing] */
const MAP = [
  ['dispatch.js', 'src/services/notify/dispatch.js', false],
  ['index.js', 'src/services/notify/index.js', false],
  ['scheduler.js', 'src/services/scheduler.js', false],
  ['subscriptions.js', 'src/data/subscriptions.js', false],
  ['subscriptions.handler.js', 'src/api/handlers/subscriptions.js', false],
  ['adminPage.html', 'src/views/adminPage.html', false],
  ['reminder.js', 'src/services/notify/reminder.js', false],
  ['extras.js', 'src/api/handlers/extras.js', false],
  ['one-time-reminders.repo.js', 'src/data/one-time-reminders.repo.js', true],
  ['one-time-reminders.handler.js', 'src/api/handlers/one-time-reminders.handler.js', true],
  ['process-one-time.js', 'src/services/process-one-time.js', true]
];

function mustExist(p, label) {
  if (!fs.existsSync(p)) throw new Error(`[inject] 缺少 ${label}: ${p}`);
}

console.log('[inject] root =', root);

for (const [fromName, toRel, createIfMissing] of MAP) {
  const from = path.join(assets, fromName);
  const to = path.join(root, toRel);
  if (!fs.existsSync(from)) {
    console.warn(`[inject] skip missing asset: ${fromName}`);
    continue;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (!createIfMissing && !fs.existsSync(to)) {
    throw new Error(`[inject] 目标不存在: ${toRel}`);
  }
  fs.copyFileSync(from, to);
  console.log(`[inject] ${fromName} → ${toRel}`);
}

const checks = [
  ['src/services/notify/dispatch.js', 'normalizeNotifyChannels'],
  ['src/services/process-one-time.js', 'processOneTimeReminders'],
  ['src/data/one-time-reminders.repo.js', 'one_time_reminder:'],
  ['src/api/handlers/extras.js', 'handleOneTimeReminderRoutes'],
  ['src/views/adminPage.html', 'oneTimeReminderModal']
];

for (const [rel, marker] of checks) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  if (!text.includes(marker)) throw new Error(`[inject] 校验失败 ${rel} :: ${marker}`);
  console.log(`[inject] ok ${rel}`);
}

console.log('[inject] 完成');
