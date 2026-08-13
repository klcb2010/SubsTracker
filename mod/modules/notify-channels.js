// @ts-check
/**
 * 订阅级通知渠道：规范化与解析（mod 自有逻辑）
 *
 * 注意：不要从 dispatch.js import ALL_CHANNELS，否则会与
 * dispatch → notify-channels → dispatch 形成循环依赖。
 */

/** 与 dispatch.ALL_CHANNELS 的 key 保持一致 */
const VALID = [
  'telegram',
  'notifyx',
  'webhook',
  'wechatbot',
  'email',
  'bark',
  'gotify',
  'serverchan',
  'pushplus',
  'ntfy'
];

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
    return enabled.filter((name) => VALID.includes(name));
  }
  return preferredList.filter(
    (name) => enabled.includes(name) && VALID.includes(name)
  );
}
