// @ts-check
/**
 * 处理到期的一次性定时提醒（小时精度，不受 NOTIFICATION_HOURS 限制）
 */
import * as otrRepo from '../data/one-time-reminders.repo.js';
import { dispatch } from './notify/dispatch.js';
import { getNowInTimezone } from '../core/time.js';

/**
 * @param {{ SUBSCRIPTIONS_KV: KVNamespace }} env
 * @param {any} config
 * @returns {Promise<{ checked: number, sent: number, failed: number }>}
 */
export async function processOneTimeReminders(env, config) {
  const timezone = config.TIMEZONE || 'Asia/Shanghai';
  const now = getNowInTimezone(timezone);
  const y = now.parts.year;
  const m = String(now.parts.month).padStart(2, '0');
  const d = String(now.parts.day).padStart(2, '0');
  const hourNorm = String(Number(now.hourString)).padStart(2, '0');
  const today = `${y}-${m}-${d}`;

  const pending = await otrRepo.listPending(env);
  let sent = 0;
  let failed = 0;
  let checked = 0;

  for (const item of pending) {
    const itemHour = String(Number(item.hour)).padStart(2, '0');
    const dueKey = `${item.date}T${itemHour}`;
    const nowKey = `${today}T${hourNorm}`;
    const isThisHour = item.date === today && itemHour === hourNorm;
    const isOverdue = dueKey < nowKey;

    if (!isThisHour && !isOverdue) continue;

    if (isOverdue) {
      try {
        const dueUtcGuess = Date.parse(`${item.date}T${itemHour}:00:00+08:00`);
        const lagMs = Date.now() - (Number.isFinite(dueUtcGuess) ? dueUtcGuess : Date.now());
        if (lagMs > 48 * 3600 * 1000) {
          item.status = 'cancelled';
          item.lastError = '超过 48 小时未发送，已自动取消';
          await otrRepo.save(env, item);
          continue;
        }
      } catch (_) {
        /* ignore */
      }
    }

    checked++;
    const title = item.title || '定时提醒';
    const content = item.content || '';
    try {
      const result = await dispatch(
        { title, content },
        config,
        {
          env,
          subId: `otr:${item.id}`,
          ruleId: 'one-time',
          logPrefix: '[定时提醒]',
          channels: item.channels
        }
      );
      if (result.successCount > 0) {
        item.status = 'sent';
        item.sentAt = new Date().toISOString();
        item.lastError = result.failedCount > 0 ? '部分渠道失败' : null;
        sent++;
      } else {
        item.status = 'failed';
        item.lastError = result.attempted === 0 ? '无可用渠道' : '全部渠道发送失败';
        failed++;
      }
    } catch (err) {
      item.status = 'failed';
      item.lastError = err && err.message ? err.message : String(err);
      failed++;
    }
    await otrRepo.save(env, item);
  }

  if (checked > 0) {
    console.log(`[定时提醒] 检查 ${checked} 条，成功 ${sent}，失败 ${failed}`);
  }
  return { checked, sent, failed };
}
