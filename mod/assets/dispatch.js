// @ts-check
/**
 * 通知调度器：把一条通知并发分发到指定/启用的渠道，并把结果写入通知日志。
 *
 * 调用方：
 * - services/scheduler.js（定时到期检查）
 * - api/handlers/test-notification.js（手动测试单个渠道）
 * - api/handlers/notify.js（第三方 /api/notify/{token}）
 * - api/handlers/subscriptions.js（单条订阅测试）
 */

import { telegramChannel } from './telegram.js';
import { notifyxChannel } from './notifyx.js';
import { webhookChannel } from './webhook.js';
import { wecomChannel } from './wechat.js';
import { emailChannel } from './email.js';
import { barkChannel } from './bark.js';
import { gotifyChannel } from './gotify.js';
import { serverChanChannel } from './serverchan.js';
import { pushplusChannel } from './pushplus.js';
import { ntfyChannel } from './ntfy.js';
import { writeLog } from '../../data/notification-logs.repo.js';

/** 名字到渠道实例的映射；新增渠道在此注册即可 */
export const ALL_CHANNELS = {
  telegram: telegramChannel,
  notifyx: notifyxChannel,
  webhook: webhookChannel,
  wechatbot: wecomChannel,
  email: emailChannel,
  bark: barkChannel,
  gotify: gotifyChannel,
  serverchan: serverChanChannel,
  pushplus: pushplusChannel,
  ntfy: ntfyChannel
};

/** 合法渠道名集合 */
export const VALID_CHANNEL_NAMES = Object.keys(ALL_CHANNELS);

/**
 * 规范化订阅上的 notifyChannels。
 * - null / undefined / 空数组 → null（表示跟随全局）
 * - 其它 → 去重后的合法渠道名数组
 *
 * @param {unknown} input
 * @returns {string[] | null}
 */
export function normalizeNotifyChannels(input) {
  if (input == null) return null;
  if (!Array.isArray(input)) return null;
  const set = new Set();
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const name = item.trim().toLowerCase();
    if (VALID_CHANNEL_NAMES.includes(name)) set.add(name);
  }
  if (set.size === 0) return null;
  return Array.from(set);
}

/**
 * 计算实际要发送的渠道名列表。
 * 优先用 preferred；否则用全局 ENABLED_NOTIFIERS。
 * 最终都会与「系统已启用渠道」取交集。
 *
 * @param {any} config
 * @param {string[] | null | undefined} preferred
 * @returns {string[]}
 */
export function resolveChannelNames(config, preferred) {
  const enabled = Array.isArray(config.ENABLED_NOTIFIERS)
    ? config.ENABLED_NOTIFIERS.map((n) => String(n).toLowerCase())
    : [];
  const preferredList = normalizeNotifyChannels(preferred);
  if (!preferredList || preferredList.length === 0) {
    return enabled.filter((name) => ALL_CHANNELS[name] != null);
  }
  return preferredList.filter(
    (name) => enabled.includes(name) && ALL_CHANNELS[name] != null
  );
}

/**
 * @typedef {Object} DispatchOptions
 * @property {any} [env] 若提供，会同时把每条结果写入 notify_log
 * @property {string} [subId] 关联的订阅 ID（写日志用）
 * @property {string} [ruleId] 触发的提醒规则 ID（写日志用）
 * @property {Object} [metadata] 附加给 channel.send 的 metadata
 * @property {string} [logPrefix] console 日志前缀
 * @property {string[] | null} [channels] 指定渠道子集；空/不传则用全局启用渠道
 */

/**
 * 把一条通知发到解析后的渠道列表。
 *
 * @param {{ title: string, content: string }} payload
 * @param {any} config 系统配置（含 ENABLED_NOTIFIERS 与各渠道字段）
 * @param {DispatchOptions} [options]
 * @returns {Promise<{
 *   attempted: number,
 *   successCount: number,
 *   failedCount: number,
 *   results: import('./channel.js').ChannelResult[],
 *   channelResults: Record<string, boolean>
 * }>}
 */
export async function dispatch(payload, config, options = {}) {
  const prefix = options.logPrefix || '[notify]';
  const names = resolveChannelNames(config, options.channels);
  const channels = names.map((name) => ALL_CHANNELS[name]).filter((ch) => ch != null);

  if (channels.length === 0) {
    console.log(`${prefix} 未启用任何通知渠道（或订阅指定渠道均未在全局启用）`);
    return { attempted: 0, successCount: 0, failedCount: 0, results: [], channelResults: {} };
  }

  const settled = await Promise.allSettled(
    channels.map((ch) =>
      ch.send({ ...payload, metadata: options.metadata }, config).catch((err) => ({
        success: false,
        channel: ch.name,
        error: err && err.message ? err.message : String(err)
      }))
    )
  );

  /** @type {import('./channel.js').ChannelResult[]} */
  const results = settled.map((r, idx) => {
    if (r.status === 'fulfilled') {
      return /** @type {any} */ (r.value);
    }
    return {
      success: false,
      channel: channels[idx].name,
      error: r.reason && r.reason.message ? r.reason.message : String(r.reason)
    };
  });

  /** @type {Record<string, boolean>} */
  const channelResults = {};
  let successCount = 0;
  let failedCount = 0;
  for (const r of results) {
    channelResults[r.channel] = r.success;
    if (r.success) {
      successCount++;
      console.log(`${prefix} ${r.channel} 发送成功`);
    } else {
      failedCount++;
      console.log(`${prefix} ${r.channel} 发送失败: ${r.error}`);
    }

    if (options.env && options.subId) {
      try {
        await writeLog(options.env, {
          subId: options.subId,
          ruleId: options.ruleId || null,
          channel: r.channel,
          status: r.success ? 'success' : 'failed',
          title: payload.title,
          content: payload.content,
          error: r.error,
          raw: r.raw
        });
      } catch (err) {
        console.warn(`${prefix} 写通知日志失败:`, err);
      }
    }
  }

  return {
    attempted: results.length,
    successCount,
    failedCount,
    results,
    channelResults
  };
}

/**
 * 测试某个渠道（用于配置页"测试发送"按钮）。
 *
 * @param {string} channelName
 * @param {any} config
 * @returns {Promise<import('./channel.js').ChannelResult>}
 */
export async function testChannel(channelName, config) {
  const ch = ALL_CHANNELS[channelName];
  if (!ch) {
    return {
      success: false,
      channel: channelName,
      error: `未知渠道: ${channelName}`
    };
  }
  try {
    return await ch.test(config);
  } catch (err) {
    return {
      success: false,
      channel: channelName,
      error: err && err.message ? err.message : String(err)
    };
  }
}
