// =============================================================
// 家庭学习助手 V3 - 错题闭环（极简版）
// 部署: learn.obsync.xyz
// 3 个 API: /api/today, /api/answer, /api/upload
// 复习规则: 答对 +3天, 答错 +1天, 连 3 次对 = 掌握
// =============================================================
//
// 配套文档:
//   E:\Program Files (x86)\Obsidian Vault\项目笔记\小学学习资料\开发状态.md
//   E:\Program Files (x86)\Obsidian Vault\项目笔记\小学学习资料\接手开发指南.md
//
// 部署命令:
//   cd E:\solo\learn-family-assistant
//   "C:\Users\Think\AppData\Roaming\npm\wrangler.cmd" deploy
//
// 数据备份 (在 Obsidian 笔记库):
//   - learn-schema.sql   (D1 schema)
//   - seed-bb.sql        (大宝 79 必背题)
//   - seed-xb.sql        (小宝 99 入门题)
// =============================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      // ===== 路由 =====
      if (path === '/' || path === '/index.html') {
        return serveHome(env);
      }

      if (path === '/manifest.json') {
        return new Response(JSON.stringify({
          name: '学习助手',
          short_name: '学习助手',
          start_url: '/',
          display: 'standalone',
          background_color: '#F9FAFB',
          theme_color: '#4F46E5'
        }), { headers: { 'Content-Type': 'application/manifest+json' } });
      }

      if (path === '/favicon.ico') {
        return new Response('', { status: 204 });
      }

      if (path === '/api/child/list' && method === 'GET') {
        return jsonOk(await listChildren(env));
      }

      if (path === '/api/today' && method === 'GET') {
        return jsonOk(await getToday(
          url.searchParams.get('child_id'),
          parseInt(url.searchParams.get('limit') || '10'),
          env
        ));
      }

      if (path === '/api/answer' && method === 'POST') {
        return jsonOk(await submitAnswer(request, env));
      }

      if (path === '/api/upload' && method === 'POST') {
        const r = await uploadWrong(request, env);
        if (r.error) return jsonError(r.error, 400);
        return jsonOk(r);
      }

      if (path === '/api/wrong/update' && method === 'POST') {
        return jsonOk(await updateWrong(request, env));
      }

      if (path === '/api/wrong/delete' && method === 'POST') {
        return jsonOk(await deleteWrong(request, env));
      }

      if (path === '/api/wrong/list' && method === 'GET') {
        return jsonOk(await listAllWrong(
          url.searchParams.get('child_id'),
          parseInt(url.searchParams.get('limit') || '50'),
          env
        ));
      }

      if (path === '/api/points' && method === 'GET') {
        return jsonOk(await getPoints(url.searchParams.get('child_id'), env));
      }

      return jsonError('未找到端点: ' + path, 404);
    } catch (e) {
      return jsonError('服务器错误: ' + e.message, 500);
    }
  }
};

// =============================================================
// CORS / JSON 工具
// =============================================================
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

function jsonOk(data) {
  return new Response(JSON.stringify({ ok: true, data }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

// =============================================================
// 业务 API
// =============================================================

async function listChildren(env) {
  const r = await env.DB.prepare("SELECT id, name, grade, avatar FROM child ORDER BY id").all();
  return { children: r.results || [] };
}

// 今日任务：错题（wrong_book） + 必背题（review_item）混合
async function getToday(childId, limit, env) {
  if (!childId) return { error: '缺少 child_id' };
  limit = Math.min(Math.max(limit, 5), 20); // 5-20 之间

  // 1. 错题（wrong_book）—— 优先全选，不分类
  const wbR = await env.DB.prepare(`
    SELECT id, subject, image_base64, note, correct_answer, mastered
    FROM wrong_book
    WHERE child_id = ? AND next_review_date <= date('now') AND mastered = 0
    ORDER BY next_review_date ASC, id ASC
    LIMIT ?
  `).bind(childId, limit).all();

  let items = (wbR.results || []).map(r => ({
    type: 'wrong_book',
    id: r.id,
    subject: r.subject,
    image_base64: r.image_base64,
    note: r.note,
    correct_answer: r.correct_answer
  }));

  // 2. 必背题补足 —— 学科平衡（避免全一类）
  if (items.length < limit) {
    const need = limit - items.length;
    const riR = await env.DB.prepare(`
      SELECT id, content_type as subject, content_ref as note, prompt, answer as correct_answer
      FROM review_item
      WHERE child_id = ?
        AND (next_review_at <= date('now') OR mastered = 0)
        AND mastered = 0
        AND id IN (
          SELECT id FROM review_item
          WHERE child_id = ?
            AND (next_review_at <= date('now') OR mastered = 0)
            AND mastered = 0
          ORDER BY RANDOM()
          LIMIT ?
        )
      ORDER BY content_type, RANDOM()
      LIMIT ?
    `).bind(childId, childId, need * 2, need).all();

    const riItems = (riR.results || []).map(r => ({
      type: 'review_item',
      id: r.id,
      subject: r.subject,
      image_base64: null,
      note: r.prompt || r.note,
      correct_answer: r.correct_answer
    }));
    items = items.concat(riItems);
  }

  // 3. 学科平衡：打乱顺序
  items = shuffleArray(items);

  // 4. 积分 + 徽章
  let points = await env.DB.prepare("SELECT * FROM points WHERE child_id = ?").bind(childId).first();
  if (!points) {
    await env.DB.prepare("INSERT INTO points (child_id) VALUES (?)").bind(childId).run();
    points = { total_points: 0, level: 1 };
  }

  const badgesR = await env.DB.prepare("SELECT badge_type, earned_at FROM badge WHERE child_id = ?").bind(childId).all();
  const badges = (badgesR.results || []).map(b => ({
    ...b,
    emoji: { '坚持7天': '🎯', '50题': '⭐', '背诵王': '📚', '全对': '🔥' }[b.badge_type] || '🏅'
  }));

  return { items, points, badges };
}

// 提交答案
async function submitAnswer(request, env) {
  const { type, id, child_answer, child_id } = await request.json();
  if (!type || !id || child_answer == null || !child_id) {
    return { error: '缺少参数' };
  }

  const today = new Date().toISOString().slice(0, 10);

  if (type === 'wrong_book') {
    const wb = await env.DB.prepare("SELECT * FROM wrong_book WHERE id = ? AND child_id = ?").bind(id, child_id).first();
    if (!wb) return { error: '错题不存在' };

    const isCorrect = normalize(child_answer) === normalize(wb.correct_answer);

    let nextReview, mastered, consecutive;
    if (isCorrect) {
      consecutive = (wb.consecutive_correct || 0) + 1;
      mastered = consecutive >= 3 ? 1 : 0;
      if (mastered) {
        nextReview = '9999-12-31';
      } else {
        nextReview = addDays(today, 3);
      }
    } else {
      consecutive = 0;
      mastered = 0;
      nextReview = addDays(today, 1);
    }

    await env.DB.prepare(`
      UPDATE wrong_book
      SET child_answer = ?,
          next_review_date = ?,
          consecutive_correct = ?,
          mastered = ?,
          last_reviewed_at = datetime('now')
      WHERE id = ?
    `).bind(child_answer, nextReview, consecutive, mastered, id).run();

    if (isCorrect) {
      await addPoints(child_id, 10, env);
      if (mastered) await addPoints(child_id, 40, env);
    }
    await checkBadges(child_id, env);

    return {
      is_correct: isCorrect,
      correct_answer: wb.correct_answer,
      next_review: nextReview,
      mastered: mastered
    };
  }

  if (type === 'review_item') {
    const ri = await env.DB.prepare("SELECT * FROM review_item WHERE id = ? AND child_id = ?").bind(id, child_id).first();
    if (!ri) return { error: '必背题不存在' };

    const isCorrect = normalize(child_answer) === normalize(ri.answer);

    let nextReview, mastered, consecutive;
    if (isCorrect) {
      consecutive = (ri.consecutive_correct || 0) + 1;
      mastered = consecutive >= 3 ? 1 : 0;
      nextReview = mastered ? '9999-12-31' : addDays(today, 3);
    } else {
      consecutive = 0;
      mastered = 0;
      nextReview = addDays(today, 1);
    }

    await env.DB.prepare(`
      UPDATE review_item
      SET last_reviewed_at = datetime('now'),
          next_review_at = ?,
          consecutive_correct = ?,
          mastered = ?
      WHERE id = ?
    `).bind(nextReview, consecutive, mastered, id).run();

    if (isCorrect) {
      await addPoints(child_id, 10, env);
      if (mastered) await addPoints(child_id, 40, env);
    }
    await checkBadges(child_id, env);

    return {
      is_correct: isCorrect,
      correct_answer: ri.answer,
      next_review: nextReview,
      mastered: mastered
    };
  }

  return { error: '未知 type' };
}

// 录入错题
async function uploadWrong(request, env) {
  const ct = request.headers.get('content-type') || '';

  if (ct.includes('application/json')) {
    const body = await request.json();
    const { child_id, subject, note, correct_answer, image_base64 } = body;
    if (!child_id) return { error: '缺少 child_id' };
    if (!correct_answer) return { error: '必须填正确答案' };

    const today = new Date().toISOString().slice(0, 10);
    const r = await env.DB.prepare(`
      INSERT INTO wrong_book (child_id, subject, image_base64, note, correct_answer, next_review_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(child_id, subject || '其他', image_base64 || null, note || '', correct_answer, today).run();

    return { wrong_book_id: r.meta.last_row_id, today };
  }

  const fd = await request.formData();
  const file = fd.get('file');
  const childId = fd.get('child_id');
  const subject = fd.get('subject') || '其他';
  const note = fd.get('note') || '';
  const correctAns = fd.get('correct_answer') || '';

  if (!childId) return { error: '缺少 child_id' };
  if (!correctAns) return { error: '必须填正确答案' };

  let imageBase64 = null;
  if (file && file.size > 0) {
    if (file.size > 800 * 1024) {
      return { error: `照片太大（${(file.size/1024).toFixed(0)}KB），前端应已自动压缩，请换张照片` };
    }
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    imageBase64 = `data:${file.type || 'image/jpeg'};base64,${btoa(binary)}`;
  }

  const today = new Date().toISOString().slice(0, 10);
  const r = await env.DB.prepare(`
    INSERT INTO wrong_book (child_id, subject, image_base64, note, correct_answer, next_review_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(childId, subject, imageBase64, note, correctAns, today).run();

  return { wrong_book_id: r.meta.last_row_id, today };
}

// 编辑错题
async function updateWrong(request, env) {
  const { id, child_id, subject, note, correct_answer, mastered } = await request.json();
  if (!id || !child_id) return { error: '缺少 id 或 child_id' };

  const fields = [];
  const values = [];
  if (subject !== undefined) { fields.push('subject = ?'); values.push(subject); }
  if (note !== undefined) { fields.push('note = ?'); values.push(note); }
  if (correct_answer !== undefined) { fields.push('correct_answer = ?'); values.push(correct_answer); }
  if (mastered !== undefined) {
    fields.push('mastered = ?');
    values.push(mastered ? 1 : 0);
    if (mastered) {
      fields.push('next_review_date = ?');
      values.push('9999-12-31');
    }
  }
  if (fields.length === 0) return { error: '没有要更新的字段' };

  values.push(id, child_id);
  await env.DB.prepare(`
    UPDATE wrong_book SET ${fields.join(', ')}
    WHERE id = ? AND child_id = ?
  `).bind(...values).run();

  return { updated: true };
}

// 删除错题
async function deleteWrong(request, env) {
  const { id, child_id } = await request.json();
  if (!id || !child_id) return { error: '缺少 id 或 child_id' };

  await env.DB.prepare(`
    DELETE FROM wrong_book WHERE id = ? AND child_id = ?
  `).bind(id, child_id).run();

  return { deleted: true };
}

// 列出孩子所有错题
async function listAllWrong(childId, limit, env) {
  if (!childId) return { error: '缺少 child_id' };
  const r = await env.DB.prepare(`
    SELECT id, subject, image_base64, note, correct_answer, mastered,
           next_review_date, consecutive_correct, created_at
    FROM wrong_book
    WHERE child_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).bind(childId, limit).all();

  return { wrong: r.results || [] };
}

// 积分
async function getPoints(childId, env) {
  if (!childId) return { error: '缺少 child_id' };
  const r = await env.DB.prepare("SELECT * FROM points WHERE child_id = ?").bind(childId).first();
  return r || { total_points: 0, level: 1 };
}

async function addPoints(childId, delta, env) {
  await env.DB.prepare(`
    UPDATE points
    SET total_points = total_points + ?,
        level = (total_points + ?) / 100 + 1,
        last_active_date = date('now')
    WHERE child_id = ?
  `).bind(delta, delta, childId).run();
  await checkBadges(childId, env);
}

async function checkBadges(childId, env) {
  // 50 题
  const p = await env.DB.prepare("SELECT total_points FROM points WHERE child_id = ?").bind(childId).first();
  if (p && p.total_points >= 500) {
    await env.DB.prepare("INSERT OR IGNORE INTO badge (child_id, badge_type) VALUES (?, '50题')").bind(childId).run();
  }
  // 坚持 7 天
  const r = await env.DB.prepare(`
    SELECT COUNT(DISTINCT date(last_reviewed_at)) AS days
    FROM wrong_book WHERE child_id = ? AND last_reviewed_at IS NOT NULL
  `).bind(childId).first();
  if (r && r.days >= 7) {
    await env.DB.prepare("INSERT OR IGNORE INTO badge (child_id, badge_type) VALUES (?, '坚持7天')").bind(childId).run();
  }
  // 背诵王
  const m = await env.DB.prepare(`
    SELECT COUNT(*) AS cnt FROM review_item WHERE child_id = ? AND mastered = 1
  `).bind(childId).first();
  if (m && m.cnt >= 10) {
    await env.DB.prepare("INSERT OR IGNORE INTO badge (child_id, badge_type) VALUES (?, '背诵王')").bind(childId).run();
  }
}

// =============================================================
// 工具
// =============================================================
function normalize(s) {
  if (s == null) return '';
  return String(s).trim().toLowerCase().replace(/\s+/g, '').replace(/^0+/, '') || '0';
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// =============================================================
// PWA HTML
// =============================================================
async function serveHome(env) {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>学习助手 · learn.obsync.xyz</title>
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#4F46E5">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; background: #F9FAFB; color: #111; padding: 16px; }
    .header { text-align: center; margin-bottom: 16px; padding: 16px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 16px; }
    .header h1 { font-size: 22px; margin-bottom: 4px; }
    .header p { font-size: 13px; opacity: 0.9; }
    .child-selector { display: flex; gap: 8px; margin-bottom: 16px; }
    .child-card { flex: 1; padding: 12px; background: white; border-radius: 12px; text-align: center; cursor: pointer; border: 2px solid transparent; }
    .child-card.active { border-color: #4F46E5; background: #EEF2FF; }
    .child-card .avatar { font-size: 36px; }
    .child-card .name { font-weight: 600; font-size: 14px; margin-top: 4px; }
    .child-card .grade { font-size: 11px; color: #6B7280; }
    .card { background: white; border-radius: 12px; padding: 16px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .card h2 { font-size: 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .limit-select { font-size: 12px; padding: 2px 8px; border: 1px solid #E5E7EB; border-radius: 6px; background: white; }
    .points-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .points-num { font-size: 22px; font-weight: 700; color: #4F46E5; }
    .badge-pill { display: inline-block; padding: 3px 8px; background: #FEF3C7; color: #92400E; border-radius: 999px; font-size: 11px; }
    .task-card { padding: 12px; border: 1px solid #E5E7EB; border-radius: 8px; margin-bottom: 8px; }
    .task-card .head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
    .task-card .type-tag { display: inline-block; padding: 2px 8px; background: #EEF2FF; color: #4F46E5; border-radius: 4px; font-size: 11px; }
    .task-card .type-tag.wrong { background: #FEE2E2; color: #B91C1C; }
    .task-card .subject-tag { font-size: 11px; color: #6B7280; }
    .task-card .img-box { width: 100%; max-height: 240px; background: #F3F4F6; border-radius: 6px; overflow: hidden; margin-bottom: 8px; display: flex; align-items: center; justify-content: center; }
    .task-card .img-box img { max-width: 100%; max-height: 240px; object-fit: contain; }
    .task-card .note { font-size: 14px; color: #374151; margin-bottom: 8px; line-height: 1.5; }
    .task-card .row { display: flex; gap: 8px; }
    .task-card input { flex: 1; padding: 8px 12px; border: 1px solid #E5E7EB; border-radius: 6px; font-size: 15px; }
    .task-card .btn { padding: 8px 16px; border-radius: 6px; border: 0; font-size: 14px; font-weight: 600; cursor: pointer; background: #4F46E5; color: white; }
    .task-card .btn:disabled { background: #9CA3AF; cursor: not-allowed; }
    .task-card .result { font-size: 14px; padding: 6px 10px; border-radius: 4px; margin-top: 8px; }
    .task-card .result.ok { background: #D1FAE5; color: #065F46; }
    .task-card .result.err { background: #FEE2E2; color: #B91C1C; }
    .empty { text-align: center; color: #9CA3AF; padding: 24px; font-size: 14px; }
    .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
    .actions .btn { padding: 12px; border-radius: 8px; border: 0; font-size: 14px; font-weight: 600; cursor: pointer; }
    .btn-primary { background: #4F46E5; color: white; }
    .btn-secondary { background: #E5E7EB; color: #111; }
  </style>
</head>
<body>
  <div class="header">
    <h1>📚 学习助手</h1>
    <p>每天 10 题，错题再练 必背巩固</p>
  </div>

  <div class="child-selector" id="childSelector"></div>

  <div id="main"></div>

  <script>
    let currentChildId = null;
    let dailyLimit = 10;
    let todayData = null;
    let results = {};

    async function init() {
      const r = await fetch('/api/child/list');
      const j = await r.json();
      if (j.ok) renderChildren(j.data.children);
    }

    function renderChildren(children) {
      const el = document.getElementById('childSelector');
      el.textContent = '';
      children.forEach(c => {
        const card = document.createElement('div');
        card.className = 'child-card';
        card.dataset.id = c.id;
        card.onclick = () => selectChild(c.id);
        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.textContent = c.avatar || '👶';
        const name = document.createElement('div');
        name.className = 'name';
        name.textContent = c.name;
        const grade = document.createElement('div');
        grade.className = 'grade';
        grade.textContent = c.grade;
        card.appendChild(avatar);
        card.appendChild(name);
        card.appendChild(grade);
        el.appendChild(card);
      });
      if (children[0]) selectChild(children[0].id);
    }

    async function selectChild(id) {
      currentChildId = id;
      document.querySelectorAll('.child-card').forEach(e => {
        e.classList.toggle('active', e.dataset.id == id);
      });
      await loadToday();
    }

    async function loadToday() {
      results = {};
      const r = await fetch('/api/today?child_id=' + currentChildId + '&limit=' + dailyLimit);
      const j = await r.json();
      if (!j.ok) { showError(j.error); return; }
      todayData = j.data;
      renderMain();
    }

    function renderMain() {
      const t = todayData;
      const main = document.getElementById('main');
      main.textContent = '';

      const card1 = document.createElement('div');
      card1.className = 'card';
      const h2a = document.createElement('h2');
      h2a.textContent = '🏆 ';
      const pn = document.createElement('span');
      pn.className = 'points-num';
      pn.textContent = t.points.total_points;
      h2a.appendChild(pn);
      const pn2 = document.createElement('span');
      pn2.style.fontSize = '12px';
      pn2.style.color = '#6B7280';
      pn2.textContent = ' 积分  Lv.' + Math.floor(t.points.level);
      h2a.appendChild(pn2);
      if (t.badges.length > 0) {
        t.badges.forEach(b => {
          const pill = document.createElement('span');
          pill.className = 'badge-pill';
          pill.textContent = b.emoji + ' ' + b.badge_type;
          h2a.appendChild(pill);
        });
      }
      card1.appendChild(h2a);
      main.appendChild(card1);

      const card2 = document.createElement('div');
      card2.className = 'card';
      const h2b = document.createElement('h2');
      h2b.textContent = '📋 今日任务 ';
      const cnt = document.createElement('span');
      cnt.style.fontSize = '12px';
      cnt.style.color = '#6B7280';
      cnt.textContent = '(' + t.items.length + ')';
      h2b.appendChild(cnt);
      const limitSel = document.createElement('select');
      limitSel.className = 'limit-select';
      [5, 10, 15, 20].forEach(n => {
        const opt = document.createElement('option');
        opt.value = n;
        opt.textContent = '每日 ' + n + ' 题';
        if (n === dailyLimit) opt.selected = true;
        limitSel.appendChild(opt);
      });
      limitSel.onchange = () => {
        dailyLimit = parseInt(limitSel.value);
        loadToday();
      };
      h2b.appendChild(limitSel);
      card2.appendChild(h2b);

      if (t.items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = '🎉 今日无任务！休息一下吧。';
        card2.appendChild(empty);
      } else {
        t.items.forEach((item, idx) => {
          card2.appendChild(renderTask(item, idx + 1));
        });
      }
      main.appendChild(card2);

      const card3 = document.createElement('div');
      card3.className = 'card';
      const acts = document.createElement('div');
      acts.className = 'actions';
      const btn1 = document.createElement('button');
      btn1.className = 'btn btn-primary';
      btn1.textContent = '📷 拍照 / 相册';
      btn1.onclick = uploadPhoto;
      const btn2 = document.createElement('button');
      btn2.className = 'btn btn-secondary';
      btn2.textContent = '✏️ 加错题（文字）';
      btn2.onclick = addTextWrong;
      acts.appendChild(btn1);
      acts.appendChild(btn2);
      card3.appendChild(acts);

      const lib = document.createElement('div');
      lib.style.cssText = 'margin-top:12px;text-align:center;';
      const libBtn = document.createElement('a');
      libBtn.href = '#';
      libBtn.style.cssText = 'color:#4F46E5;font-size:13px;text-decoration:none;';
      libBtn.textContent = '📚 进入错题库（管理/编辑/查看已掌握）→';
      libBtn.onclick = (e) => { e.preventDefault(); showWrongLibrary(); };
      lib.appendChild(libBtn);
      card3.appendChild(lib);

      main.appendChild(card3);
    }

    function renderTask(item, idx) {
      const card = document.createElement('div');
      card.className = 'task-card';
      const key = item.type + ':' + item.id;

      const head = document.createElement('div');
      head.className = 'head';
      const typeTag = document.createElement('span');
      typeTag.className = 'type-tag' + (item.type === 'wrong_book' ? ' wrong' : '');
      typeTag.textContent = item.type === 'wrong_book' ? '错题' : '必背';
      head.appendChild(typeTag);
      const sub = document.createElement('span');
      sub.className = 'subject-tag';
      sub.textContent = (item.subject || '') + '  #' + idx;
      head.appendChild(sub);
      card.appendChild(head);

      if (item.image_base64) {
        const imgBox = document.createElement('div');
        imgBox.className = 'img-box';
        const img = document.createElement('img');
        img.src = item.image_base64;
        img.alt = '错题照片';
        imgBox.appendChild(img);
        card.appendChild(imgBox);
      }

      if (item.note) {
        const noteWrap = document.createElement('div');
        noteWrap.style.cssText = 'display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;';
        const note = document.createElement('div');
        note.className = 'note';
        note.style.marginBottom = '0';
        note.style.flex = '1';
        note.textContent = item.note;
        noteWrap.appendChild(note);

        if (item.type === 'review_item' && shouldSpeak(item.subject)) {
          const speakBtn = document.createElement('button');
          speakBtn.textContent = '🔊';
          speakBtn.style.cssText = 'flex-shrink:0;width:36px;height:36px;border:1px solid #E5E7EB;background:white;border-radius:6px;font-size:18px;cursor:pointer;padding:0;line-height:1;';
          speakBtn.title = '听发音';
          const text = extractSpeakText(item);
          const lang = detectLang(item.subject);
          speakBtn.onclick = () => speakText(text, lang);
          noteWrap.appendChild(speakBtn);
        }
        card.appendChild(noteWrap);
      }

      let options = null;
      try { options = item.options ? JSON.parse(item.options) : null; } catch(e) {}

      if (options && Array.isArray(options) && options.length >= 2) {
        const optBox = document.createElement('div');
        optBox.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;';
        options.forEach((opt) => {
          const optBtn = document.createElement('button');
          optBtn.textContent = opt;
          optBtn.style.cssText = 'padding:14px;border:2px solid #E5E7EB;background:white;border-radius:8px;font-size:18px;font-weight:600;cursor:pointer;transition:all 0.1s;';
          optBtn.dataset.value = opt;
          optBtn.onclick = () => {
            if (results[key]) return;
            submitChoice(item, key, opt, optBtn, optBox);
          };
          optBox.appendChild(optBtn);
        });
        card.appendChild(optBox);
      } else {
        const row = document.createElement('div');
        row.className = 'row';
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = '输入答案';
        input.id = 'ans-' + key;
        input.autocomplete = 'off';
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.textContent = '提交';
        btn.id = 'btn-' + key;
        btn.onclick = () => submitAnswer(item, key);
        row.appendChild(input);
        row.appendChild(btn);
        card.appendChild(row);

        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') submitAnswer(item, key);
        });
      }

      if (results[key]) {
        const r = results[key];
        const div = document.createElement('div');
        div.className = 'result ' + (r.is_correct ? 'ok' : 'err');
        div.textContent = r.is_correct
          ? '✅ 答对！' + (r.mastered ? ' 🎉 已掌握' : ' 下次复习：' + r.next_review)
          : '❌ 答错，正确答案：' + r.correct_answer;
        card.appendChild(div);
        card.querySelectorAll('button, input').forEach(el => { el.disabled = true; el.style.opacity = '0.6'; });
      }

      return card;
    }

    async function submitAnswer(item, key) {
      const input = document.getElementById('ans-' + key);
      const childAns = input.value;
      if (!childAns) { showToast('请输入答案'); return; }
      const r = await fetch('/api/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: item.type, id: item.id, child_answer: childAns, child_id: currentChildId })
      });
      const j = await r.json();
      if (!j.ok) { showToast('❌ ' + j.error); return; }
      results[key] = j.data;
      if (j.data.is_correct) {
        showToast(j.data.mastered ? '🎉 答对 +50 掌握！' : '✅ 答对 +10');
      } else {
        showToast('❌ 答错，明天再练');
      }
      loadToday();
    }

    async function submitChoice(item, key, chosen, clickedBtn, optBox) {
      clickedBtn.style.background = (chosen === item.correct_answer) ? '#D1FAE5' : '#FEE2E2';
      clickedBtn.style.borderColor = (chosen === item.correct_answer) ? '#10B981' : '#EF4444';
      optBox.querySelectorAll('button').forEach(b => { b.disabled = true; });

      if (chosen === item.correct_answer && shouldSpeak(item.subject)) {
        setTimeout(() => speakText(item.correct_answer, detectLang(item.subject)), 300);
      }

      const r = await fetch('/api/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: item.type, id: item.id, child_answer: chosen, child_id: currentChildId })
      });
      const j = await r.json();
      if (j.ok) {
        showToast(j.data.is_correct ? '🎉 答对！' : '正确：' + item.correct_answer);
        setTimeout(() => loadToday(), 1500);
      }
    }

    function showToast(msg) {
      const t = document.createElement('div');
      t.textContent = msg;
      t.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:white;padding:12px 24px;border-radius:8px;z-index:9999;font-size:14px;max-width:80%;text-align:center';
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 2500);
    }

    function showError(msg) {
      const el = document.getElementById('main');
      el.textContent = '';
      const div = document.createElement('div');
      div.className = 'empty';
      div.style.color = '#B91C1C';
      div.textContent = '❌ ' + msg;
      el.appendChild(div);
    }

    function addTextWrong() {
      const note = prompt('题目内容（必填）', '');
      if (!note || !note.trim()) {
        alert('必须填题目');
        return;
      }
      const correct = prompt('正确答案（必填）', '');
      if (!correct || !correct.trim()) {
        alert('必须填正确答案');
        return;
      }
      submitTextWrong(note.trim(), correct.trim());
    }

    async function submitTextWrong(note, correct) {
      const r = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ child_id: currentChildId, subject: '数学', note, correct_answer: correct })
      });
      const j = await r.json();
      if (j.ok) {
        showToast('✅ 错题已添加（可在错题库改学科）');
        loadToday();
      } else {
        showToast('❌ ' + j.error);
      }
    }

    function uploadPhoto() {
      const choice = prompt('拍照输 1 / 相册输 2', '1');
      if (!choice) return;

      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      if (choice === '1') {
        input.capture = 'environment';
      }
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const correct = prompt('请输入正确答案（必填）', '');
        if (!correct || !correct.trim()) {
          alert('必须填正确答案');
          return;
        }

        showToast('压缩中...');
        const compressed = await compressImage(file, 500);
        if (!compressed) {
          showToast('❌ 压缩失败');
          return;
        }

        const fd = new FormData();
        fd.append('file', compressed, file.name);
        fd.append('child_id', currentChildId);
        fd.append('subject', '数学');
        fd.append('note', '');
        fd.append('correct_answer', correct.trim());
        showToast('上传中...');
        const r = await fetch('/api/upload', { method: 'POST', body: fd });
        const j = await r.json();
        if (j.ok) {
          showToast('✅ 错题已添加（' + Math.round(compressed.size/1024) + 'KB，学科可在错题库改）');
          loadToday();
        } else {
          showToast('❌ ' + j.error);
        }
      };
      input.click();
    }

    async function compressImage(file, maxKB) {
      if (file.size <= maxKB * 1024) return file;
      return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          URL.revokeObjectURL(url);
          const maxWidth = 1200;
          const scale = Math.min(1, maxWidth / img.width);
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => resolve(blob || file), 'image/jpeg', 0.75);
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
        img.src = url;
      });
    }

    // 错题库管理
    async function showWrongLibrary() {
      const r = await fetch('/api/wrong/list?child_id=' + currentChildId);
      const j = await r.json();
      if (!j.ok) { showToast('❌ ' + j.error); return; }
      renderLibrary(j.data.wrong);
    }

    function renderLibrary(list) {
      const main = document.getElementById('main');
      main.textContent = '';

      const back = document.createElement('div');
      back.style.cssText = 'margin-bottom:12px;';
      const backBtn = document.createElement('a');
      backBtn.href = '#';
      backBtn.style.cssText = 'color:#4F46E5;font-size:14px;text-decoration:none;';
      backBtn.textContent = '← 返回今日任务';
      backBtn.onclick = (e) => { e.preventDefault(); renderMain(); };
      back.appendChild(backBtn);
      main.appendChild(back);

      const h = document.createElement('h2');
      h.style.cssText = 'font-size:18px;margin:12px 0;';
      h.textContent = '📚 错题库（共 ' + list.length + ' 题）';
      main.appendChild(h);

      const mastered = list.filter(x => x.mastered).length;
      const active = list.length - mastered;
      const stats = document.createElement('div');
      stats.style.cssText = 'font-size:13px;color:#6B7280;margin-bottom:12px;';
      stats.textContent = '未掌握 ' + active + '  ·  已掌握 ' + mastered;
      main.appendChild(stats);

      if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = '错题库是空的。点返回添加第一道错题。';
        main.appendChild(empty);
        return;
      }

      list.forEach(item => {
        main.appendChild(renderLibraryItem(item));
      });
    }

    function renderLibraryItem(item) {
      const card = document.createElement('div');
      card.className = 'task-card';

      const status = document.createElement('div');
      status.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;';
      const sub = document.createElement('span');
      sub.className = 'subject-tag';
      sub.textContent = (item.subject || '其他') + '  #' + item.id;
      status.appendChild(sub);
      const masteredTag = document.createElement('span');
      masteredTag.className = 'type-tag' + (item.mastered ? '' : ' wrong');
      masteredTag.textContent = item.mastered ? '✅ 已掌握' : '📝 未掌握';
      status.appendChild(masteredTag);
      card.appendChild(status);

      if (item.image_base64) {
        const imgBox = document.createElement('div');
        imgBox.className = 'img-box';
        const img = document.createElement('img');
        img.src = item.image_base64;
        img.alt = '错题';
        imgBox.appendChild(img);
        card.appendChild(imgBox);
      }

      if (item.note) {
        const note = document.createElement('div');
        note.className = 'note';
        note.textContent = '题目：' + item.note;
        card.appendChild(note);
      }

      const ans = document.createElement('div');
      ans.style.cssText = 'font-size:13px;color:#6B7280;margin-bottom:8px;';
      ans.textContent = '正确答案：' + (item.correct_answer || '（未填）');
      card.appendChild(ans);

      if (item.consecutive_correct !== undefined) {
        const meta = document.createElement('div');
        meta.style.cssText = 'font-size:12px;color:#9CA3AF;margin-bottom:8px;';
        meta.textContent = '连对 ' + (item.consecutive_correct || 0) + ' 次  ·  下次复习 ' + (item.next_review_date || '—');
        card.appendChild(meta);
      }

      const ops = document.createElement('div');
      ops.style.cssText = 'display:flex;gap:8px;';
      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-secondary';
      editBtn.textContent = '✏️ 编辑';
      editBtn.style.cssText = 'flex:1;padding:6px;border:1px solid #E5E7EB;background:white;border-radius:6px;cursor:pointer;font-size:13px;';
      editBtn.onclick = () => editWrong(item);
      const delBtn = document.createElement('button');
      delBtn.textContent = '🗑️ 删除';
      delBtn.style.cssText = 'flex:1;padding:6px;border:1px solid #FCA5A5;background:#FEE2E2;color:#B91C1C;border-radius:6px;cursor:pointer;font-size:13px;';
      delBtn.onclick = () => deleteWrong(item);
      ops.appendChild(editBtn);
      ops.appendChild(delBtn);
      card.appendChild(ops);

      return card;
    }

    async function editWrong(item) {
      const newNote = prompt('题目描述', item.note || '');
      if (newNote === null) return;
      const newCorrect = prompt('正确答案', item.correct_answer || '');
      if (newCorrect === null) return;
      const newSubject = prompt('学科（语文/数学/英语）', item.subject || '数学');
      if (newSubject === null) return;
      const r = await fetch('/api/wrong/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, child_id: currentChildId, subject: newSubject, note: newNote, correct_answer: newCorrect })
      });
      const j = await r.json();
      if (j.ok) { showToast('✅ 已更新'); showWrongLibrary(); }
      else { showToast('❌ ' + j.error); }
    }

    async function deleteWrong(item) {
      if (!confirm('确定要删除这道错题吗？')) return;
      const r = await fetch('/api/wrong/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, child_id: currentChildId })
      });
      const j = await r.json();
      if (j.ok) { showToast('🗑️ 已删除'); showWrongLibrary(); }
      else { showToast('❌ ' + j.error); }
    }

    // TTS 读音（Web Speech API）
    function shouldSpeak(subject) {
      if (!subject) return false;
      const s = String(subject).toLowerCase();
      return s.includes('拼音') || s.includes('英语') || s.includes('字母') ||
             s.includes('单词') || s.includes('句型') || s.includes('数字');
    }

    function detectLang(subject) {
      if (!subject) return 'zh-CN';
      const s = String(subject).toLowerCase();
      if (s.includes('英语') || s.includes('字母') || s.includes('单词') || s.includes('句型')) {
        return 'en-US';
      }
      if (s.includes('拼音') || s.includes('数字')) {
        return 'zh-CN';
      }
      return 'zh-CN';
    }

    function extractSpeakText(item) {
      const note = item.note || '';
      const PUNCT = new Set([
        '，', '。', '！', '？', '；', '：', '、',
        '“', '”', '‘', '’',
        '（', '）', '(', ')', '【', '】', '[', ']',
        '…', '—', '-', '_', '=', '+', '*', '/',
        String.fromCharCode(92),
        '|'
      ]);
      let out = '';
      const SP = String.fromCharCode(32);
      const TAB = String.fromCharCode(9);
      const NL = String.fromCharCode(10);
      const CR = String.fromCharCode(13);
      for (const ch of note) {
        if (PUNCT.has(ch)) out += SP;
        else if (ch === SP || ch === TAB || ch === NL || ch === CR) out += SP;
        else out += ch;
      }
      return out.replace(/ +/g, SP).trim();
    }

    function speakText(text, lang) {
      if (!('speechSynthesis' in window)) {
        showToast('❌ 当前浏览器不支持语音');
        return;
      }
      if (!text) {
        showToast('❌ 没有可读内容');
        return;
      }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang || 'zh-CN';
      u.rate = 0.8;
      u.pitch = 1.0;
      u.onerror = (e) => console.warn('TTS error:', e);
      window.speechSynthesis.speak(u);
    }

    init();
  </script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
