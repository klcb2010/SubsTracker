#!/usr/bin/env node
/**
 * 长期注入策略：
 * 1) mod/modules/* → src/mod/*（自有逻辑，整文件）
 * 2) 对上游文件做小段 search/replace 锚点补丁
 * 3) adminPage.html 仍整文件覆盖（前端改动面太大）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const modulesDir = path.join(__dirname, 'modules');
const assetsDir = path.join(__dirname, 'assets');

function read(p) {
  return fs.readFileSync(p, 'utf8');
}
function write(p, s) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
}
function must(p, label) {
  if (!fs.existsSync(p)) throw new Error(`[inject] 缺少 ${label}: ${p}`);
}

/** @param {string} fileRel @param {string} search @param {string} replace */
function patch(fileRel, search, replace, label) {
  const full = path.join(root, fileRel);
  must(full, fileRel);
  let text = read(full);
  if (!text.includes(search)) {
    // 已打过补丁？
    if (replace.length > 20 && text.includes(replace.trim().slice(0, 40))) {
      console.log(`[inject] skip(already) ${label}`);
      return;
    }
    throw new Error(`[inject] 锚点未找到 ${label} @ ${fileRel}\n--- search ---\n${search.slice(0, 200)}`);
  }
  if (text.split(search).length > 2) {
    console.warn(`[inject] warn: 锚点多次出现，仅替换第一处: ${label}`);
  }
  text = text.replace(search, replace);
  write(full, text);
  console.log(`[inject] patch ${label}`);
}

console.log('[inject] root =', root);

// ── 1. 复制 mod 模块 ───────────────────────────────────────────
must(modulesDir, 'mod/modules');
for (const name of fs.readdirSync(modulesDir)) {
  if (!name.endsWith('.js')) continue;
  const from = path.join(modulesDir, name);
  const to = path.join(root, 'src/mod', name);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`[inject] module → src/mod/${name}`);
}

// ── 2. adminPage 整文件 ────────────────────────────────────────
const adminFrom = path.join(assetsDir, 'adminPage.html');
const adminTo = path.join(root, 'src/views/adminPage.html');
if (fs.existsSync(adminFrom)) {
  must(adminTo, 'src/views/adminPage.html');
  fs.copyFileSync(adminFrom, adminTo);
  console.log('[inject] adminPage.html (full)');
} else {
  console.warn('[inject] skip adminPage.html (no asset)');
}

// ── 3. 上游锚点补丁 ────────────────────────────────────────────

// dispatch.js：渠道列表改为 resolveChannelNames
patch(
  'src/services/notify/dispatch.js',
  `import { writeLog } from '../../data/notification-logs.repo.js';\n`,
  `import { writeLog } from '../../data/notification-logs.repo.js';\nimport { resolveChannelNames } from '../../mod/notify-channels.js';\n`,
  'dispatch:import'
);

// DispatchOptions 增加 channels，消除 tsc 报错
patch(
  'src/services/notify/dispatch.js',
  ` * @property {string} [logPrefix] console 日志前缀
 */`,
  ` * @property {string} [logPrefix] console 日志前缀
 * @property {string[] | null} [channels] 指定渠道子集；空/不传则用全局启用渠道
 */`,
  'dispatch:typedef-channels'
);

patch(
  'src/services/notify/dispatch.js',
  `export async function dispatch(payload, config, options = {}) {
  const enabled = Array.isArray(config.ENABLED_NOTIFIERS) ? config.ENABLED_NOTIFIERS : [];
  const prefix = options.logPrefix || '[notify]';

  const channels = enabled
    .map((name) => ALL_CHANNELS[name])
    .filter((ch) => ch != null);`,
  `export async function dispatch(payload, config, options = {}) {
  const prefix = options.logPrefix || '[notify]';
  // mod: 支持 options.channels 覆盖全局 ENABLED_NOTIFIERS
  const channelNames = resolveChannelNames(config, options.channels);
  const channels = channelNames
    .map((name) => ALL_CHANNELS[name])
    .filter((ch) => ch != null);`,
  'dispatch:resolve-channels'
);

// index.js：透传 channels
patch(
  'src/services/notify/index.js',
  `  const result = await dispatch(
    { title, content: commonContent },
    config,
    {
      logPrefix,
      env: options.env,
      subId: options.subId,
      ruleId: options.ruleId,
      metadata: options.metadata
    }
  );`,
  `  const result = await dispatch(
    { title, content: commonContent },
    config,
    {
      logPrefix,
      env: options.env,
      subId: options.subId,
      ruleId: options.ruleId,
      metadata: options.metadata,
      channels: options.channels
    }
  );`,
  'index:channels'
);

// 允许 options 类型注释里出现 channels（可选，不强制）
patch(
  'src/services/notify/index.js',
  ` * @param {{ env?: any, subId?: string, ruleId?: string, metadata?: Object }} [options]`,
  ` * @param {{ env?: any, subId?: string, ruleId?: string, metadata?: Object, channels?: string[]|null }} [options]`,
  'index:jsdoc'
);

// extras.js：挂一次性提醒路由
patch(
  'src/api/handlers/extras.js',
  `import { getNextFireTime } from '../../services/notify/reminder-engine.js';\n`,
  `import { getNextFireTime } from '../../services/notify/reminder-engine.js';\nimport { handleOneTimeReminderRoutes } from '../../mod/one-time-reminders.handler.js';\n`,
  'extras:import'
);

patch(
  'src/api/handlers/extras.js',
  `export async function handleExtraRoutes(request, env, path) {
  const method = request.method;

  // /subscriptions/:id/reminders[/:ruleId]`,
  `export async function handleExtraRoutes(request, env, path) {
  const method = request.method;

  // mod: 一次性定时提醒
  const otrResp = await handleOneTimeReminderRoutes(request, env, path);
  if (otrResp) return otrResp;

  // /subscriptions/:id/reminders[/:ruleId]`,
  'extras:route'
);

// scheduler: import + processOneTime + grouped send
patch(
  'src/services/scheduler.js',
  `import { formatNotificationContent } from './notify/reminder.js';
import { dispatch } from './notify/dispatch.js';`,
  `import { formatNotificationContent } from '../mod/format-notification.js';
import { dispatch } from './notify/dispatch.js';
import { processOneTimeReminders } from '../mod/process-one-time.js';
import { sendReadyByChannelGroups } from '../mod/schedule-grouped-send.js';`,
  'scheduler:imports'
);

patch(
  'src/services/scheduler.js',
  `    const config = await getConfig(env);
    const timezone = config.TIMEZONE || 'UTC';
    const now = getNowInTimezone(timezone);`,
  `    const config = await getConfig(env);
    const timezone = config.TIMEZONE || 'UTC';
    const now = getNowInTimezone(timezone);

    // mod: 一次性定时提醒（不受 NOTIFICATION_HOURS 限制）
    try {
      await processOneTimeReminders(env, config);
    } catch (otrErr) {
      console.error('[定时提醒] 处理失败:', otrErr);
    }`,
  'scheduler:otr'
);

// 大块：聚合发送 → 分组发送（用上游原始块作锚点）
const upstreamSendStart = `    // 排序：按剩余天数升序，更紧迫的在前
    ready.sort((a, b) => a.daysDiff - b.daysDiff);

    // 一次性聚合所有订阅成一条通知（与既有渠道契约一致）
    // notify_log 按 (subId, ruleId, channel) 维度落，仍可细粒度查询
    const enrichedSubs = ready.map((c) => ({
      ...c.sub,
      daysRemaining: c.daysDiff,
      hoursRemaining: Math.round(c.hoursDiff)
    }));
    const content = formatNotificationContent(enrichedSubs, config);
    const title = '订阅到期/续费提醒';

    // 给 dispatch 提供主 subId+ruleId（聚合通知用第一条做归属）
    const primary = ready[0];
    const dispatchResult = await dispatch(
      { title, content },
      config,
      {
        env,
        subId: primary.sub.id,
        ruleId: primary.rule.id,
        logPrefix: '[定时任务]',
        metadata: {
          tags: enrichedSubs.map((s) => s.name),
          daysRemaining: primary.daysDiff,
          ruleType: primary.rule.type,
          ruleValue: primary.rule.value
        }
      }
    );
    sentCount = dispatchResult.successCount;`;

// We'll replace through status reason - need enough unique end. Use a mid-size replace calling helper for the loop body only.

// Simpler: replace just the dispatch call block to use sendReadyByChannelGroups and then set sentCount
// Actually the dedupe write is after dispatch - sendReadyByChannelGroups includes dedupe.

const upstreamFromSort = `    // 排序：按剩余天数升序，更紧迫的在前
    ready.sort((a, b) => a.daysDiff - b.daysDiff);`;

// Find if this exists after inject of format path already
// For the big replace I'll use a different approach in second patch file if this fails.

console.log('[inject] 尝试 scheduler 分组发送补丁...');

// subscriptions.js：import + create/update 写入 notifyChannels
const subFile = path.join(root, 'src/data/subscriptions.js');
let subText = read(subFile);
if (!subText.includes("from '../mod/notify-channels.js'")) {
  if (subText.includes("from '../core/time.js'") || subText.includes('from "../core/time.js"')) {
    subText = subText.replace(
      /(import .+from ['"]\.\.\/core\/time\.js['"];?\n)/,
      `$1import { normalizeNotifyChannels } from '../mod/notify-channels.js';\n`
    );
  } else {
    subText = `import { normalizeNotifyChannels } from '../mod/notify-channels.js';\n` + subText;
  }
  write(subFile, subText);
  console.log('[inject] patch subscriptions:import');
}

subText = read(subFile);
// create: 在 useLunar / createdAt 前写入 notifyChannels
if (!subText.includes('notifyChannels: normalizeNotifyChannels(subscription.notifyChannels)')) {
  const createRe = /(useLunar:\s*useLunar,\s*\n)(\s*)(createdAt:\s*new Date\(\)\.toISOString\(\))/;
  if (createRe.test(subText)) {
    subText = subText.replace(
      createRe,
      `$1$2notifyChannels: normalizeNotifyChannels(subscription.notifyChannels),\n$2$3`
    );
    write(subFile, subText);
    console.log('[inject] patch subscriptions:create-notifyChannels');
  } else {
    console.warn('[inject] warn: create notifyChannels 锚点未命中');
  }
}

subText = read(subFile);
// update: 在 useLunar / updatedAt 前写入（仅一处 update 合并对象）
if ((subText.match(/notifyChannels:\s*normalizeNotifyChannels/g) || []).length < 2) {
  const updateRe = /(useLunar:\s*useLunar,\s*\n)(\s*)(updatedAt:\s*new Date\(\)\.toISOString\(\))/;
  if (updateRe.test(subText)) {
    subText = subText.replace(
      updateRe,
      `$1$2notifyChannels:\n$2  subscription.notifyChannels !== undefined\n$2    ? normalizeNotifyChannels(subscription.notifyChannels)\n$2    : existing.notifyChannels != null\n$2      ? normalizeNotifyChannels(existing.notifyChannels)\n$2      : null,\n$2$3`
    );
    write(subFile, subText);
    console.log('[inject] patch subscriptions:update-notifyChannels');
  } else {
    console.warn('[inject] warn: update notifyChannels 锚点未命中');
  }
}

// subscriptions.handler test content + channels - optional light patch
const handlerFile = path.join(root, 'src/api/handlers/subscriptions.js');
if (fs.existsSync(handlerFile)) {
  let h = read(handlerFile);
  if (!h.includes('channels: Array.isArray(subscription.notifyChannels)')) {
    const oldCall = `const notifyResult = await sendNotificationToAllChannels(title, commonContent, config, '[手动测试]', {
      env, subId: id, ruleId: 'manual-test',
      metadata: { tags },
    });`;
    const newCall = `const notifyResult = await sendNotificationToAllChannels(title, commonContent, config, '[手动测试]', {
      env, subId: id, ruleId: 'manual-test',
      metadata: { tags },
      channels: Array.isArray(subscription.notifyChannels) ? subscription.notifyChannels : null
    });`;
    // tolerate whitespace
    const re = /sendNotificationToAllChannels\(\s*title,\s*commonContent,\s*config,\s*'\[手动测试\]',\s*\{[^}]*metadata:\s*\{\s*tags\s*\}[^}]*\}\s*\)/;
    if (h.includes("metadata: { tags }")) {
      h = h.replace(
        /metadata:\s*\{\s*tags\s*\}/,
        `metadata: { tags },
      channels: Array.isArray(subscription.notifyChannels) ? subscription.notifyChannels : null`
      );
      write(handlerFile, h);
      console.log('[inject] patch subscriptions.handler:channels');
    }
  }
}

// scheduler grouped send - replace original aggregate block
let sched = read(path.join(root, 'src/services/scheduler.js'));
if (!sched.includes('sendReadyByChannelGroups')) {
  const re = /\/\/ 排序：按剩余天数升序，更紧迫的在前\n\s*ready\.sort\(\(a, b\) => a\.daysDiff - b\.daysDiff\);[\s\S]*?sentCount = dispatchResult\.successCount;/;
  const replacement = `// mod: 按渠道分组发送
    const grouped = await sendReadyByChannelGroups({
      ready,
      config,
      env,
      now,
      formatNotificationContent,
      dispatch,
      dedupeTtlSec: DEDUPE_TTL_SEC,
      writeLastFireAt
    });
    sentCount = grouped.totalSuccess;
    const dispatchResult = {
      successCount: grouped.totalSuccess,
      failedCount: grouped.totalFailed,
      attempted: grouped.totalAttempted,
      channelResults: grouped.mergedChannelResults
    };`;
  if (!re.test(sched)) {
    console.warn('[inject] warn: scheduler 分组发送锚点未命中，保留上游聚合发送逻辑');
  } else {
    sched = sched.replace(re, replacement);
    // remove duplicate dedupe block that followed old dispatch - dangerous
    // Old code still has "if (dispatchResult.successCount > 0) { dedupe...}" - sendReadyByChannelGroups already did dedupe
    // Remove the following dedupe block once
    const dedupeRe = /\/\/ 仅在至少一渠道成功时写入去重与 lastFire，失败可在后续 tick 重试\n\s*if \(dispatchResult\.successCount > 0\) \{\n\s*const firedAt = now\.utc\.toISOString\(\);\n\s*await Promise\.all\(\n\s*ready\.map\(async \(c\) => \{\n\s*await env\.SUBSCRIPTIONS_KV\.put\(c\.dedupeKey, '1', \{ expirationTtl: DEDUPE_TTL_SEC \}\);\n\s*if \(c\.rule\.type === 'after_expiry'\) \{\n\s*await writeLastFireAt\(env, c\.sub\.id, c\.rule\.id, firedAt\);\n\s*\}\n\s*\}\)\n\s*\);\n\s*\}/;
    if (dedupeRe.test(sched)) {
      sched = sched.replace(dedupeRe, '// mod: 去重已在 sendReadyByChannelGroups 内完成');
    }
    write(path.join(root, 'src/services/scheduler.js'), sched);
    console.log('[inject] patch scheduler:grouped-send');
  }
} else {
  console.log('[inject] skip scheduler:grouped-send (already)');
}

// 校验
const checks = [
  ['src/mod/notify-channels.js', 'normalizeNotifyChannels'],
  ['src/mod/process-one-time.js', 'processOneTimeReminders'],
  ['src/services/notify/dispatch.js', 'resolveChannelNames'],
  ['src/api/handlers/extras.js', 'handleOneTimeReminderRoutes']
];
for (const [rel, marker] of checks) {
  const t = read(path.join(root, rel));
  if (!t.includes(marker)) throw new Error(`[inject] 校验失败 ${rel} :: ${marker}`);
  console.log(`[inject] ok ${rel}`);
}

console.log('[inject] 完成（长期：mod 模块 + 锚点补丁）');

