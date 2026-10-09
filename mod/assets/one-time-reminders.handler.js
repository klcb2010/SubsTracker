// @ts-check
import * as otrRepo from '../../data/one-time-reminders.repo.js';
import { getConfig } from '../../data/config.js';
import { dispatch } from '../../services/notify/dispatch.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * /api/one-time-reminders[/:id][/test]
 * @param {Request} request
 * @param {{ SUBSCRIPTIONS_KV: KVNamespace }} env
 * @param {string} path
 */
export async function handleOneTimeReminderRoutes(request, env, path) {
  const method = request.method;
  const m = path.match(/^\/one-time-reminders(?:\/([^/]+))?(\/test)?\/?$/);
  if (!m) return null;

  const id = m[1] || null;
  const isTest = !!m[2];

  if (!id && method === 'GET') {
    const list = await otrRepo.listAll(env);
    return json({ success: true, items: list });
  }

  if (!id && method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ success: false, message: '无效 JSON' }, 400);
    }
    const date = String(body.date || '').trim();
    const hour = String(body.hour ?? '').trim();
    const content = String(body.content || '').trim();
    const title = String(body.title || '定时提醒').trim() || '定时提醒';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return json({ success: false, message: '日期格式应为 YYYY-MM-DD' }, 400);
    }
    const hourNum = Number(hour);
    if (!Number.isInteger(hourNum) || hourNum < 0 || hourNum > 23) {
      return json({ success: false, message: '小时应为 0-23 的整数' }, 400);
    }
    if (!content) {
      return json({ success: false, message: '内容不能为空' }, 400);
    }
    /** @type {import('../../data/one-time-reminders.repo.js').OneTimeReminder} */
    const item = {
      id: otrRepo.makeId(),
      title,
      content,
      date,
      hour: String(hourNum).padStart(2, '0'),
      channels: otrRepo.normalizeChannels(body.channels),
      status: /** @type {'pending'} */ ('pending'),
      createdAt: new Date().toISOString(),
      sentAt: null,
      lastError: null
    };
    await otrRepo.save(env, item);
    return json({ success: true, item });
  }

  if (id && method === 'DELETE') {
    await otrRepo.remove(env, id);
    return json({ success: true });
  }

  if (id && isTest && method === 'POST') {
    const item = await otrRepo.getById(env, id);
    if (!item) return json({ success: false, message: '不存在' }, 404);
    const config = await getConfig(env);
    const result = await dispatch(
      { title: `[测试] ${item.title}`, content: item.content },
      config,
      {
        env,
        subId: `otr:${item.id}`,
        ruleId: 'one-time-test',
        logPrefix: '[定时提醒测试]',
        channels: item.channels
      }
    );
    return json({
      success: result.successCount > 0,
      message:
        result.successCount > 0
          ? `已发送（成功 ${result.successCount} / 尝试 ${result.attempted}）`
          : '发送失败',
      result
    });
  }

  if (id && method === 'PUT') {
    const existing = await otrRepo.getById(env, id);
    if (!existing) return json({ success: false, message: '不存在' }, 404);
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ success: false, message: '无效 JSON' }, 400);
    }
    let rearm = false;
    if (body.title != null) {
      existing.title = String(body.title).trim() || existing.title;
      rearm = true;
    }
    if (body.content != null) {
      const c = String(body.content).trim();
      if (!c) return json({ success: false, message: '内容不能为空' }, 400);
      existing.content = c;
      rearm = true;
    }
    if (body.date != null) {
      const date = String(body.date).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return json({ success: false, message: '日期格式应为 YYYY-MM-DD' }, 400);
      }
      existing.date = date;
      rearm = true;
    }
    if (body.hour != null) {
      const hourNum = Number(body.hour);
      if (!Number.isInteger(hourNum) || hourNum < 0 || hourNum > 23) {
        return json({ success: false, message: '小时应为 0-23 的整数' }, 400);
      }
      existing.hour = String(hourNum).padStart(2, '0');
      rearm = true;
    }
    if (body.channels !== undefined) {
      existing.channels = otrRepo.normalizeChannels(body.channels);
      rearm = true;
    }
    if (body.status === 'cancelled') {
      existing.status = /** @type {'cancelled'} */ ('cancelled');
    } else if (body.status === 'pending' || rearm) {
      // 重启或修改后重新进入待执行
      existing.status = /** @type {'pending'} */ ('pending');
      existing.sentAt = null;
      existing.lastError = null;
    }
    await otrRepo.save(env, existing);
    return json({ success: true, item: existing });
  }

  return json({ success: false, message: '不支持的方法' }, 405);
}
