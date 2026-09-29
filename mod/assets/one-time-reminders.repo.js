// @ts-check
/**
 * 一次性定时提醒仓库
 *
 * KV:
 *   one_time_reminder:{id} -> JSON
 *   one_time_reminders:index -> string[] ids
 */

const KEY_PREFIX = 'one_time_reminder:';
const INDEX_KEY = 'one_time_reminders:index';

/**
 * @typedef {Object} OneTimeReminder
 * @property {string} id
 * @property {string} title
 * @property {string} content
 * @property {string} date  YYYY-MM-DD（用户时区本地日）
 * @property {string} hour  HH（00-23，用户时区）
 * @property {string[]|null} channels
 * @property {'pending'|'sent'|'failed'|'cancelled'} status
 * @property {string} createdAt
 * @property {string|null} [sentAt]
 * @property {string|null} [lastError]
 */

/** @returns {string} */
export function makeId() {
  return crypto.randomUUID();
}

/**
 * @param {{ SUBSCRIPTIONS_KV: KVNamespace }} env
 * @returns {Promise<string[]>}
 */
async function readIndex(env) {
  const raw = await env.SUBSCRIPTIONS_KV.get(INDEX_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * @param {{ SUBSCRIPTIONS_KV: KVNamespace }} env
 * @param {string[]} ids
 */
async function writeIndex(env, ids) {
  await env.SUBSCRIPTIONS_KV.put(INDEX_KEY, JSON.stringify(ids));
}

/**
 * @param {{ SUBSCRIPTIONS_KV: KVNamespace }} env
 * @param {string} id
 * @returns {Promise<OneTimeReminder|null>}
 */
export async function getById(env, id) {
  const raw = await env.SUBSCRIPTIONS_KV.get(KEY_PREFIX + id);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * @param {{ SUBSCRIPTIONS_KV: KVNamespace }} env
 * @returns {Promise<OneTimeReminder[]>}
 */
export async function listAll(env) {
  const ids = await readIndex(env);
  const out = [];
  for (const id of ids) {
    const item = await getById(env, id);
    if (item) out.push(item);
  }
  out.sort((a, b) => {
    const ka = `${a.date}T${a.hour}`;
    const kb = `${b.date}T${b.hour}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return out;
}

/**
 * @param {{ SUBSCRIPTIONS_KV: KVNamespace }} env
 * @returns {Promise<OneTimeReminder[]>}
 */
export async function listPending(env) {
  const all = await listAll(env);
  return all.filter((r) => r && r.status === 'pending');
}

/**
 * @param {{ SUBSCRIPTIONS_KV: KVNamespace }} env
 * @param {OneTimeReminder} item
 */
export async function save(env, item) {
  await env.SUBSCRIPTIONS_KV.put(KEY_PREFIX + item.id, JSON.stringify(item));
  const ids = await readIndex(env);
  if (!ids.includes(item.id)) {
    ids.push(item.id);
    await writeIndex(env, ids);
  }
}

/**
 * @param {{ SUBSCRIPTIONS_KV: KVNamespace }} env
 * @param {string} id
 */
export async function remove(env, id) {
  await env.SUBSCRIPTIONS_KV.delete(KEY_PREFIX + id);
  const ids = await readIndex(env);
  const next = ids.filter((x) => x !== id);
  await writeIndex(env, next);
}

/**
 * @param {unknown} input
 * @returns {string[]|null}
 */
export function normalizeChannels(input) {
  if (input == null) return null;
  if (!Array.isArray(input)) return null;
  const allowed = new Set([
    'telegram', 'notifyx', 'webhook', 'wechatbot', 'email',
    'bark', 'gotify', 'serverchan', 'pushplus', 'ntfy'
  ]);
  const set = new Set();
  for (const x of input) {
    if (typeof x !== 'string') continue;
    const n = x.trim().toLowerCase();
    if (allowed.has(n)) set.add(n);
  }
  return set.size ? Array.from(set) : null;
}
