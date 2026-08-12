import { formatTimeInTimezone, formatTimezoneDisplay, getTimezoneDateParts } from '../../core/time.js';
import { lunarCalendar } from '../../core/lunar.js';
import { formatAmount } from '../../core/currency-format.js';

/**
 * 按用户时区把到期日转成农历展示文案，避免用 Date 本地分量导致差一天。
 *
 * @param {Date | string | number} expiry
 * @param {string} timezone
 * @returns {string} 空串表示无法转换或不展示
 */
function formatLunarExpiryText(expiry, timezone) {
  const parts = getTimezoneDateParts(expiry, timezone || 'UTC');
  const lunarExpiry = lunarCalendar.solar2lunar(parts.year, parts.month, parts.day);
  return lunarExpiry ? `\n农历日期: ${lunarExpiry.fullStr}` : '';
}

function resolveReminderSetting(subscription) {
  const defaultDays = subscription && subscription.reminderDays !== undefined ? Number(subscription.reminderDays) : 7;
  let unit = subscription && subscription.reminderUnit === 'hour' ? 'hour' : 'day';

  let value;
  if (unit === 'hour') {
    if (subscription && subscription.reminderValue !== undefined && subscription.reminderValue !== null && !isNaN(Number(subscription.reminderValue))) {
      value = Number(subscription.reminderValue);
    } else if (subscription && subscription.reminderHours !== undefined && subscription.reminderHours !== null && !isNaN(Number(subscription.reminderHours))) {
      value = Number(subscription.reminderHours);
    } else {
      value = 0;
    }
  } else {
    if (subscription && subscription.reminderValue !== undefined && subscription.reminderValue !== null && !isNaN(Number(subscription.reminderValue))) {
      value = Number(subscription.reminderValue);
    } else if (!isNaN(defaultDays)) {
      value = Number(defaultDays);
    } else {
      value = 7;
    }
  }

  if (value < 0 || isNaN(value)) {
    value = 0;
  }

  return { unit, value };
}

function shouldTriggerReminder(reminder, daysDiff, hoursDiff) {
  if (!reminder) {
    return false;
  }
  if (reminder.unit === 'hour') {
    if (reminder.value === 0) {
      return hoursDiff >= 0 && hoursDiff < 1;
    }
    return hoursDiff >= 0 && hoursDiff <= reminder.value;
  }
  if (reminder.value === 0) {
    return daysDiff === 0;
  }
  return daysDiff >= 0 && daysDiff <= reminder.value;
}

function formatNotificationContent(subscriptions, config) {
  const showLunar = config.SHOW_LUNAR === true;
  const timezone = config?.TIMEZONE || 'UTC';
  let content = '';

  for (const sub of subscriptions) {
    const expiryDateObj = new Date(sub.expiryDate);
    const formattedExpiryDate = formatTimeInTimezone(expiryDateObj, timezone, 'date');

    let lunarExpiryText = '';
    if (showLunar) {
      lunarExpiryText = formatLunarExpiryText(expiryDateObj, timezone);
    }

    let statusText = '';
    if (sub.daysRemaining === 0) {
      statusText = '今天到期！';
    } else if (sub.daysRemaining < 0) {
      statusText = `已过期 ${Math.abs(sub.daysRemaining)} 天`;
    } else {
      statusText = `将在 ${sub.daysRemaining} 天后到期`;
    }

    const autoRenewText = sub.autoRenew ? '是' : '否';
    const notesText = (sub.notes && String(sub.notes).trim())
      ? String(sub.notes).trim()
      : '';

    let block = `**${sub.name}**
到期日期: ${formattedExpiryDate}${lunarExpiryText}
自动续期: ${autoRenewText}
到期状态: ${statusText}`;
    if (notesText) {
      block += `\n备注: ${notesText}`;
    }

    content += block + '\n\n';
  }

  const currentTime = formatTimeInTimezone(new Date(), timezone, 'datetime');
  content += `发送时间: ${currentTime}`;

  return content;
}

export { resolveReminderSetting, shouldTriggerReminder, formatNotificationContent };
