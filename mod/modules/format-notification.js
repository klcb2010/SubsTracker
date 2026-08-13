// @ts-check
import { formatTimeInTimezone } from '../core/time.js';
import { lunarCalendar } from '../core/lunar.js';
import { getTimezoneDateParts } from '../core/time.js';

function formatLunarExpiryText(expiry, timezone) {
  try {
    const parts = getTimezoneDateParts(expiry, timezone);
    const lunar = lunarCalendar.solar2lunar(parts.year, parts.month, parts.day);
    return lunar ? ` (农历: ${lunar.fullStr})` : '';
  } catch {
    return '';
  }
}

/**
 * 精简版到期通知正文
 * @param {any[]} subscriptions
 * @param {any} config
 */
export function formatNotificationContent(subscriptions, config) {
  const showLunar = config.SHOW_LUNAR === true;
  const timezone = config?.TIMEZONE || 'UTC';
  let content = '';

  for (const sub of subscriptions) {
    const expiryDateObj = new Date(sub.expiryDate);
    const formattedExpiryDate = formatTimeInTimezone(expiryDateObj, timezone, 'date');
    let lunarExpiryText = '';
    if (showLunar) lunarExpiryText = formatLunarExpiryText(expiryDateObj, timezone);

    let statusText = '';
    if (sub.daysRemaining === 0) statusText = '今天到期！';
    else if (sub.daysRemaining < 0) statusText = `已过期 ${Math.abs(sub.daysRemaining)} 天`;
    else statusText = `将在 ${sub.daysRemaining} 天后到期`;

    const autoRenewText = sub.autoRenew ? '是' : '否';
    const notesText =
      sub.notes && String(sub.notes).trim() ? String(sub.notes).trim() : '';

    let block = `**${sub.name}**
到期日期: ${formattedExpiryDate}${lunarExpiryText}
自动续期: ${autoRenewText}
到期状态: ${statusText}`;
    if (notesText) block += `\n备注: ${notesText}`;
    content += block + '\n\n';
  }

  const currentTime = formatTimeInTimezone(new Date(), timezone, 'datetime');
  content += `发送时间: ${currentTime}`;
  return content;
}
