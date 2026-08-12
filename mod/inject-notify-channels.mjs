#!/usr/bin/env node
/**
 * 注入：订阅可选独立通知渠道 (notifyChannels)
 *
 * 用 mod/assets/ 下的已打补丁文件覆盖仓库对应路径。
 * 仅在 CI 工作区生效，不提交进 git。
 *
 * 用法：node mod/inject-notify-channels.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const assets = path.join(__dirname, 'assets');

/** @type {Array<[string, string]>} */
const MAP = [
  ['dispatch.js', 'src/services/notify/dispatch.js'],
  ['index.js', 'src/services/notify/index.js'],
  ['scheduler.js', 'src/services/scheduler.js'],
  ['subscriptions.js', 'src/data/subscriptions.js'],
  ['subscriptions.handler.js', 'src/api/handlers/subscriptions.js'],
  ['adminPage.html', 'src/views/adminPage.html']
];

function mustExist(p, label) {
  if (!fs.existsSync(p)) {
    throw new Error(`[inject] 缺少 ${label}: ${p}`);
  }
}

console.log('[inject] 开始注入 notifyChannels ...');
console.log('[inject] root   =', root);
console.log('[inject] assets =', assets);

for (const [fromName, toRel] of MAP) {
  const from = path.join(assets, fromName);
  const to = path.join(root, toRel);
  mustExist(from, `asset ${fromName}`);
  mustExist(path.dirname(to), `目标目录 ${path.dirname(toRel)}`);
  if (!fs.existsSync(to)) {
    throw new Error(`[inject] 上游缺少目标文件，请更新映射: ${toRel}`);
  }
  fs.copyFileSync(from, to);
  console.log(`[inject] wrote ${toRel}`);
}

const checks = [
  ['src/services/notify/dispatch.js', 'normalizeNotifyChannels'],
  ['src/services/scheduler.js', 'notifyChannels'],
  ['src/data/subscriptions.js', 'normalizeNotifyChannels(subscription.notifyChannels)'],
  ['src/api/handlers/subscriptions.js', 'subscription.notifyChannels'],
  ['src/views/adminPage.html', 'notifyChannelsUseGlobal']
];

for (const [rel, marker] of checks) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  if (!text.includes(marker)) {
    throw new Error(`[inject] 校验失败，未找到标记 ${marker} @ ${rel}`);
  }
}

console.log('[inject] notifyChannels 注入完成');
