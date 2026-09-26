// @ts-check
import { formatTimeInTimezone, getTimezoneDateParts } from '../core/time.js';
import { lunarCalendar } from '../core/lunar.js';
import { resolveReminderSetting } from '../services/notify/reminder.js';

/**
 * @param {any} rule
 * @returns {string}
 */
function formatMatchedReminderRule(rule) {
  if (!rule) return '';
  if (rule.type === 'on_expiry') return '到期当天';
  if (rule.type === 'after_expiry') {
    return '到期后每 ' + (rule.repeatInterval || 24) + ' 小时';
  }
  if (rule.value === 0) return rule.unit === 'hours' ? '到期当小时' : '到期当天';
  return '提前 ' + rule.value + ' ' + (rule.unit === 'hours' ? '小时' : '天');
}

/**
 * @param {Date} expiry
 * @param {string} timezone
 */
function formatLunarExpiryText(expiry, timezone) {
  try {
    const parts = getTimezoneDateParts(expiry, timezone);
    const lunar = lunarCalendar.solar2lunar(parts.year, parts.month, parts.day);
    return lunar ? ' (农历: ' + lunar.fullStr + ')' : '';
  } catch {
    return '';
  }
}

/**
 * 精简版到期通知正文（保留「提醒策略」行以兼容上游测试与可读性）
 * @param {any[]} subscriptions
 * @param {any} config
 */
export function formatNotificationContent(subscriptions, config) {
  const showLunar = config.SHOW_LUNAR === true;
  const timezone = (config && config.TIMEZONE) || 'UTC';
  let content = '';

  for (const sub of subscriptions) {
    const expiryDateObj = new Date(sub.expiryDate);
    const formattedExpiryDate = formatTimeInTimezone(expiryDateObj, timezone, 'date');
    let lunarExpiryText = '';
    if (showLunar) lunarExpiryText = formatLunarExpiryText(expiryDateObj, timezone);

    let statusText = '';
    if (sub.daysRemaining === 0) {
      statusText = '今天到期！';
    } else if (sub.daysRemaining < 0) {
      statusText = '已过期 ' + Math.abs(sub.daysRemaining) + ' 天';
    } else {
      statusText = '将在 ' + sub.daysRemaining + ' 天后到期';
    }

    const autoRenewText = sub.autoRenew ? '是' : '否';
    const notesText =
      sub.notes && String(sub.notes).trim() ? String(sub.notes).trim() : '';

    const reminderSetting = sub.matchedReminderRule ? null : resolveReminderSetting(sub);
    const reminderSuffix =
      reminderSetting && reminderSetting.value === 0
        ? '（仅到期时提醒）'
        : reminderSetting && reminderSetting.unit === 'hour'
          ? '（小时级提醒）'
          : '';

    let reminderText = '';
    if (sub.matchedReminderRule) {
      reminderText = '提醒策略: ' + formatMatchedReminderRule(sub.matchedReminderRule);
    } else if (reminderSetting) {
      const unitLabel = reminderSetting.unit === 'hour' ? '小时' : '天';
      reminderText =
        '提醒策略: 提前 ' + reminderSetting.value + ' ' + unitLabel + reminderSuffix;
    }

    let block =
      '**' +
      sub.name +
      '**\n到期日期: ' +
      formattedExpiryDate +
      lunarExpiryText +
      '\n自动续期: ' +
      autoRenewText;
    if (reminderText) block += '\n' + reminderText;
    block += '\n到期状态: ' + statusText;
    if (notesText) block += '\n备注: ' + notesText;
    content += block + '\n\n';
  }

  const currentTime = formatTimeInTimezone(new Date(), timezone, 'datetime');
  content += '发送时间: ' + currentTime;
  return content;
}
