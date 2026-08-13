// @ts-check
/**
 * 按订阅 notifyChannels 分组发送到期提醒（mod）
 */

/**
 * @param {object} args
 * @param {any[]} args.ready
 * @param {any} args.config
 * @param {any} args.env
 * @param {{ utc: Date }} args.now
 * @param {(subs: any[], config: any) => string} args.formatNotificationContent
 * @param {typeof import('../services/notify/dispatch.js').dispatch} args.dispatch
 * @param {number} args.dedupeTtlSec
 * @param {(env: any, subId: string, ruleId: string, firedAt: string) => Promise<void>} args.writeLastFireAt
 */
export async function sendReadyByChannelGroups(args) {
  const {
    ready,
    config,
    env,
    now,
    formatNotificationContent,
    dispatch,
    dedupeTtlSec,
    writeLastFireAt
  } = args;

  ready.sort((a, b) => a.daysDiff - b.daysDiff);

  /** @type {Map<string, typeof ready>} */
  const groups = new Map();
  for (const c of ready) {
    const ch =
      Array.isArray(c.sub.notifyChannels) && c.sub.notifyChannels.length > 0
        ? [...c.sub.notifyChannels].map((x) => String(x).toLowerCase()).sort()
        : [];
    const key = ch.join(',');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  let totalSuccess = 0;
  let totalFailed = 0;
  let totalAttempted = 0;
  /** @type {Record<string, boolean>} */
  const mergedChannelResults = {};

  for (const [key, group] of groups) {
    const enrichedSubs = group.map((c) => ({
      ...c.sub,
      daysRemaining: c.daysDiff,
      hoursRemaining: Math.round(c.hoursDiff)
    }));
    const content = formatNotificationContent(enrichedSubs, config);
    const title = '订阅到期/续费提醒';
    const primary = group[0];
    const channelsOpt = key ? key.split(',').filter(Boolean) : null;

    const dispatchResult = await dispatch(
      { title, content },
      config,
      {
        env,
        subId: primary.sub.id,
        ruleId: primary.rule.id,
        logPrefix: '[定时任务]',
        channels: channelsOpt,
        metadata: {
          tags: enrichedSubs.map((s) => s.name),
          daysRemaining: primary.daysDiff,
          ruleType: primary.rule.type,
          ruleValue: primary.rule.value
        }
      }
    );

    totalSuccess += dispatchResult.successCount;
    totalFailed += dispatchResult.failedCount;
    totalAttempted += dispatchResult.attempted;
    Object.assign(mergedChannelResults, dispatchResult.channelResults || {});

    if (dispatchResult.successCount > 0) {
      const firedAt = now.utc.toISOString();
      await Promise.all(
        group.map(async (c) => {
          await env.SUBSCRIPTIONS_KV.put(c.dedupeKey, '1', { expirationTtl: dedupeTtlSec });
          if (c.rule.type === 'after_expiry') {
            await writeLastFireAt(env, c.sub.id, c.rule.id, firedAt);
          }
        })
      );
    }
  }

  return {
    totalSuccess,
    totalFailed,
    totalAttempted,
    groupsSize: groups.size,
    mergedChannelResults
  };
}
