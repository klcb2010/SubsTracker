// @ts-check
/**
 * 订阅级通知渠道：规范化与解析（mod 自有逻辑）
 */
import { ALL_CHANNELS } from '../services/notify/dispatch.js';

const VALID = Object.keys(ALL_CHANNELS);

/**
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
    if (VALID.includes(name)) set.add(name);
  }
  return set.size ? Array.from(set) : null;
}

/**
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
