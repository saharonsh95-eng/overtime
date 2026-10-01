/* שעות נוספות – PWA */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const DEMO = new URLSearchParams(location.search).has('demo') || !/^https:\/\//.test(CFG.API_URL || '');
  const TOKEN_KEY = 'ot_token';
  const HEB_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  const HEB_DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

  const state = {
    token: null,
    me: null,
    view: 'mine',          // mine | admin
    month: null,           // yyyy-MM shown in "mine"
    adminMonth: null,
    mine: null,
    admin: null,
  };

  const $app = document.getElementById('app');
  const $sheet = document.getElementById('sheet-root');

  /* ================= utils ================= */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const monthLabel = (ym) => `${HEB_MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;
  const shiftMonth = (ym, n) => { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const dayOf = (iso) => { const [y, m, d] = iso.split('-').map(Number); return { d, w: HEB_DAYS[new Date(y, m - 1, d).getDay()], m }; };
  const fmtDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const fmtH = (h) => { const n = Math.round(Number(h || 0) * 100) / 100; return String(n); };
  const statusChip = (s) => s === 'מאושר' ? '<span class="chip ok">מאושר</span>' : s === 'נדחה' ? '<span class="chip bad">נדחה</span>' : '<span class="chip warn">ממתין לאישור</span>';

  const ICON = {
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5" stroke-linecap="round"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
  };

  function toast(msg, isErr) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'show' + (isErr ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.className = ''; }, isErr ? 4500 : 2500);
  }
  function busy(on) { document.getElementById('busy').hidden = !on; }

  /* ================= API ================= */
  async function api(action, payload) {
    if (DEMO) return window.MockAPI.call(action, payload);
    let res;
    try {
      res = await fetch(CFG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // מונע preflight מול Apps Script
        body: JSON.stringify({ action, payload: payload || {}, idToken: state.token }),
      });
    } catch (e) {
      throw new Error('אין חיבור לאינטרנט');
    }
    const j = await res.json().catch(() => ({ ok: false, error: 'תגובה לא תקינה מהשרת' }));
    if (!j.ok) {
      const err = new Error(j.error || 'שגיאה');
      err.code = j.code;
      if (j.code === 'AUTH') { signOut(true); }
      throw err;
    }
    return j.data;
  }

  // מריץ פעולה עם מחוון טעינה והודעת שגיאה
  async function run(fn, okMsg) {
    busy(true);
    try {
      const r = await fn();
      if (okMsg) toast(okMsg);
      return r;
    } catch (e) {
      if (e.code !== 'AUTH') toast(e.message, true);
      throw e;
    } finally {
      busy(false);
    }
  }

  /* ================= auth ================= */
  function decodeJwt(t) {
    try { return JSON.parse(decodeURIComponent(escape(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); } catch (e) { return null; }
  }
  function loadToken() {
    try {
      const t = localStorage.getItem(TOKEN_KEY);
      const p = t && decodeJwt(t);
      if (p && p.exp * 1000 > Date.now() + 60000) return t;
    } catch (e) { /* ignore */ }
    return null;
  }
  function saveToken(t) { try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { /* ignore */ } }

  function whenGoogle() {
    return new Promise((resolve) => {
      if (window.google && google.accounts && google.accounts.id) return resolve();
      const iv = setInterval(() => {
        if (window.google && google.accounts && google.accounts.id) { clearInterval(iv); resolve(); }
      }, 100);
    });
  }

  let gisReady = false;
  async function initGoogle() {
    await whenGoogle();
    if (gisReady) return;
    google.accounts.id.initialize({
      client_id: CFG.CLIENT_ID,
      callback: (resp) => { state.token = resp.credential; saveToken(resp.credential); boot(); },
      auto_select: true,
      cancel_on_tap_outside: false,
      itp_support: true,
      use_fedcm_for_prompt: true,
    });
    gisReady = true;
  }

  function signOut(expired) {
    state.token = null; state.me = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
    if (!expired && window.google && google.accounts) google.accounts.id.disableAutoSelect();
    renderLogin(expired);
  }

  /* ================= boot ================= */
  async function boot() {
    if (!DEMO && !state.token) state.token = loadToken();
    if (!DEMO && !state.token) return renderLogin();
    try {
      state.me = await api('whoami');
    } catch (e) {
      if (e.code === 'AUTH') return;
      $app.innerHTML = `<div class="hero"><h1>אופס</h1><p>${esc(e.message)}</p><button class="btn primary" id="retry">נסו שוב</button></div>`;
      document.getElementById('retry').onclick = boot;
      return;
    }
    state.month = state.month || state.me.currentMonth;
    state.adminMonth = state.adminMonth || state.me.currentMonth;
    const linked = state.me.link && state.me.link.status === 'מאושר';
    if (!linked && !state.me.isOwner) return renderLink();
    if (state.me.isOwner && !linked && state.view === 'mine') state.view = 'admin';
    renderShell();
  }

  /* ================= login ================= */
  async function renderLogin(expired) {
    $app.innerHTML = `
      <div class="hero">
        <img src="icons/icon-192.png" alt="">
        <h1>${esc(CFG.TITLE || 'שעות נוספות')}</h1>
        <p>${esc(CFG.SUBTITLE || '')}${expired ? '<br>ההתחברות פגה – יש להתחבר שוב' : '<br>התחברו עם חשבון Google כדי לדווח שעות'}</p>
        <div id="gbtn"></div>
      </div>`;
    await initGoogle();
    google.accounts.id.renderButton(document.getElementById('gbtn'), {
      theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', locale: 'he', width: 260,
    });
    google.accounts.id.prompt();
  }

  /* ================= link (first time) ================= */
  function renderLink(changing) {
    const me = state.me;
    const pending = me.link && me.link.status === 'ממתין' && !changing;
    const rejected = me.link && me.link.status === 'נדחה' && !changing;
    let body;
    if (pending) {
      body = `
        <div class="card" style="text-align:center">
          <div style="font-size:40px">⏳</div>
          <h2 style="margin:6px 0">הבקשה נשלחה</h2>
          <p class="muted">ביקשת להשתייך ל<b>${esc(me.link.tab)}</b>.<br>אחרי שמנהל יאשר, אפשר יהיה לדווח שעות.</p>
          <div class="actions"><button class="btn primary" id="chk">בדיקה אם אושר</button></div>
          <button class="linkbtn" id="chg" style="margin-top:10px">טעיתי בשם – בחירה מחדש</button>
        </div>`;
    } else {
      const tabs = me.tabs || [];
      body = `
        ${rejected ? `<div class="banner">הבקשה להשתייך ל"${esc(me.link.tab)}" נדחתה. אפשר לבחור שוב.</div>` : ''}
        <div class="section-title">מי את/ה? בחר/י את השם שלך</div>
        <p class="muted small" style="margin:-4px 4px 12px">הבחירה תישלח לאישור מנהל. אחרי האישור תוכל/י לדווח רק על עצמך.</p>
        <div class="pick">
          ${tabs.map((t) => `<button data-tab="${esc(t.tab)}" ${t.taken ? 'disabled' : ''}>${esc(t.tab)}${t.taken ? '<small>כבר משויך</small>' : ''}</button>`).join('')}
        </div>`;
    }
    $app.innerHTML = topbar() + `<main>${body}</main>`;
    bindTopbar();
    $app.querySelectorAll('.pick button[data-tab]').forEach((b) => {
      b.onclick = () => confirmSheet(`להשתייך ל"${b.dataset.tab}"?`, 'הבקשה תישלח למנהל לאישור.', 'שליחה', async () => {
        await run(() => api('requestLink', { tab: b.dataset.tab }), 'הבקשה נשלחה');
        boot();
      });
    });
    const chk = document.getElementById('chk');
    if (chk) chk.onclick = () => run(boot);
    const chg = document.getElementById('chg');
    if (chg) chg.onclick = async () => { await run(async () => { state.me = await api('whoami'); state.me.tabs = state.me.tabs || []; }); renderLink(true); };
  }

  /* ================= shell ================= */
  function topbar() {
    const me = state.me;
    const initial = (me.name || me.email || '?').trim().charAt(0);
    const style = me.picture ? `style="background-image:url('${esc(me.picture)}')"` : '';
    const sub = me.link && me.link.status === 'מאושר' ? me.link.tab : me.email;
    return `
      <header class="topbar">
        <div class="titles"><h1>${esc(CFG.TITLE || 'שעות נוספות')} ${esc(CFG.SUBTITLE || '')}</h1><div class="sub">${esc(sub)}${DEMO ? ' · מצב הדגמה' : ''}</div></div>
        <button class="avatar" id="me" ${style} aria-label="חשבון">${me.picture ? '' : esc(initial)}</button>
      </header>`;
  }
  function bindTopbar() {
    document.getElementById('me').onclick = () => {
      openSheet(`
        <h2>${esc(state.me.name)}</h2>
        <p class="muted" style="margin-top:-8px">${esc(state.me.email)}${state.me.isOwner ? ' · מנהל/ת' : ''}</p>
        <button class="btn ghost block" id="so">התנתקות</button>`, (root) => {
        root.querySelector('#so').onclick = () => { closeSheet(); if (DEMO) { location.search = ''; } else signOut(); };
      });
    };
  }

  function renderShell() {
    const me = state.me;
    const linked = me.link && me.link.status === 'מאושר';
    const pendingCount = state.admin ? state.admin.pending.length + state.admin.users.filter((u) => u.status === 'ממתין').length : 0;
    const nav = me.isOwner ? `
      <nav class="bottomnav">
        <button data-v="mine" class="${state.view === 'mine' ? 'active' : ''}">${ICON.clock}השעות שלי</button>
        <button data-v="admin" class="${state.view === 'admin' ? 'active' : ''}">${ICON.shield}ניהול${pendingCount ? `<span class="badge">${pendingCount}</span>` : ''}</button>
      </nav>` : '';
    $app.innerHTML = topbar() + `<main id="main"></main>` + nav +
      (state.view === 'mine' && linked ? '<button class="btn primary fab" id="add">+ דיווח שעות</button>' : '');
    document.body.classList.toggle('no-nav', !me.isOwner);
    bindTopbar();
    $app.querySelectorAll('.bottomnav button').forEach((b) => { b.onclick = () => { state.view = b.dataset.v; renderShell(); }; });
    const add = document.getElementById('add');
    if (add) add.onclick = () => entryForm();
    if (state.view === 'admin') loadAdmin(); else if (linked) loadMine(); else renderMineUnlinked();
    if (me.isOwner && state.view !== 'admin') {
      api('adminData', { month: state.adminMonth }).then((d) => { state.admin = d; updateBadge(); }).catch(() => {});
    }
  }

  function monthbar(ym, id) {
    return `
      <div class="monthbar">
        <button class="iconbtn" data-mb="${id}" data-d="-1" aria-label="חודש קודם">${ICON.prev}</button>
        <div class="label">${monthLabel(ym)}</div>
        <button class="iconbtn" data-mb="${id}" data-d="1" aria-label="חודש הבא">${ICON.next}</button>
      </div>`;
  }
  function bindMonthbar(id, onChange) {
    document.querySelectorAll(`[data-mb="${id}"]`).forEach((b) => { b.onclick = () => onChange(Number(b.dataset.d)); });
  }

  /* ================= my hours ================= */
  function renderMineUnlinked() {
    const main = document.getElementById('main');
    const l = state.me.link;
    if (l && l.status === 'ממתין') {
      main.innerHTML = `<div class="card"><b>ממתין לאישור</b><p class="muted small">ביקשת להשתייך ל"${esc(l.tab)}". מנהל אחר (או את/ה, בלשונית ניהול) צריך לאשר.</p></div>`;
      return;
    }
    main.innerHTML = `<div class="card"><b>לא משויך/ת לשם ברשימה</b><p class="muted small">כמנהל/ת אפשר לנהל בלי שיוך. אם גם את/ה מדווח/ת שעות – בחר/י את השם שלך.</p><button class="btn primary block" id="lnk">בחירת שם</button></div>`;
    document.getElementById('lnk').onclick = async () => { await run(async () => { state.me = await api('whoami'); }); renderLink(true); };
  }

  async function loadMine() {
    const main = document.getElementById('main');
    if (!state.mine || state.mine.month !== state.month) main.innerHTML = '<div class="boot" style="min-height:40vh"><div class="spinner"></div></div>';
    else renderMine();
    try {
      state.mine = await api('myEntries', { month: state.month });
      if (state.view === 'mine') renderMine();
    } catch (e) {
      if (e.code === 'NOT_LINKED') return boot();
      main.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    }
  }

  function entryCard(e, opts) {
    const day = dayOf(e.date);
    return `
      <div class="card entry">
        <div class="day"><b>${day.d}</b><span>יום ${day.w}</span></div>
        <div class="body">
          ${opts && opts.who ? `<div class="who">${esc(e.tab)}${e.name && e.name !== e.tab ? ` <span class="muted small">(${esc(e.name)})</span>` : ''}</div>` : ''}
          <div class="row1">
            <span class="hours"><span class="num">${fmtH(e.hours)}</span> ש׳</span>
            ${e.start || e.end ? `<span class="times num">${esc(e.start)}–${esc(e.end)}</span>` : ''}
            ${opts && opts.who ? `<span class="muted small">${fmtDate(e.date)}</span>` : statusChip(e.status)}
          </div>
          ${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}
          ${e.status === 'נדחה' && e.reason ? `<div class="note" style="color:var(--bad)">סיבה: ${esc(e.reason)}</div>` : ''}
          ${opts && opts.actions ? opts.actions : ''}
        </div>
      </div>`;
  }

  function renderMine() {
    const m = state.mine;
    const main = document.getElementById('main');
    if (!main || !m) return;
    const all = [...m.pending, ...m.rejected, ...m.approved].sort((a, b) => b.date.localeCompare(a.date));
    main.innerHTML = `
      ${monthbar(m.month, 'mine')}
      ${m.missingFile ? '<div class="banner">עדיין לא נפתח קובץ לחודש הזה. אפשר לדווח – הדיווח יאושר אחרי שהמנהל יפתח את החודש.</div>' : ''}
      <div class="stats">
        <div class="stat ok"><div class="v num">${fmtH(m.totals.approved)}</div><div class="k">שעות מאושרות</div></div>
        <div class="stat warn"><div class="v num">${fmtH(m.totals.pending)}</div><div class="k">ממתינות לאישור</div></div>
      </div>
      <div class="section-title">הדיווחים שלי</div>
      ${all.length ? all.map((e) => entryCard(e, {
        actions: e.status === 'ממתין' ? `<div class="actions"><button class="btn small danger" data-del="${esc(e.id)}">מחיקה</button></div>`
          : e.status === 'נדחה' ? `<div class="actions"><button class="btn small ghost" data-fix="${esc(e.id)}">דיווח מתוקן</button><button class="btn small danger" data-del="${esc(e.id)}">הסרה</button></div>` : '',
      })).join('') : '<div class="empty">אין דיווחים בחודש הזה</div>'}
    `;
    bindMonthbar('mine', (d) => { state.month = shiftMonth(state.month, d); loadMine(); });
    main.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = () => confirmSheet('למחוק את הדיווח?', '', 'מחיקה', async () => {
        await run(() => api('deletePending', { id: b.dataset.del }), 'נמחק');
        loadMine();
      }, true);
    });
    main.querySelectorAll('[data-fix]').forEach((b) => {
      b.onclick = () => entryForm(m.rejected.find((x) => x.id === b.dataset.fix));
    });
  }

  function entryForm(prefill) {
    const p = prefill || {};
    const defDate = p.date || (state.month === todayISO().slice(0, 7) ? todayISO() : `${state.month}-01`);
    openSheet(`
      <h2>דיווח שעות נוספות</h2>
      <form id="ef" novalidate>
        <label class="field"><span>תאריך</span><input class="input" type="date" name="date" value="${esc(defDate)}" required></label>
        <div class="grid2">
          <label class="field"><span>שעת כניסה</span><input class="input" type="time" name="start" value="${esc(p.start || '')}" required></label>
          <label class="field"><span>שעת יציאה</span><input class="input" type="time" name="end" value="${esc(p.end || '')}" required></label>
        </div>
        <label class="field"><span>שעות נוספות</span><input class="input" type="number" inputmode="decimal" step="0.25" min="0.25" max="24" name="hours" value="${esc(p.hours || '')}" placeholder="לדוגמה 2.5" required></label>
        <label class="field"><span>הערה (לא חובה)</span><textarea class="input" name="note" maxlength="300" placeholder="אירוע, החלפה, תרגיל...">${esc(p.note || '')}</textarea></label>
        <button class="btn primary block" type="submit">שליחה לאישור</button>
      </form>`, (root) => {
      root.querySelector('#ef').onsubmit = async (ev) => {
        ev.preventDefault();
        const f = Object.fromEntries(new FormData(ev.target).entries());
        if (!f.date) return toast('יש לבחור תאריך', true);
        if (!f.start || !f.end) return toast('יש למלא שעת כניסה ויציאה', true);
        const h = Number(String(f.hours).replace(',', '.'));
        if (!(h > 0 && h <= 24)) return toast('יש למלא מספר שעות נוספות (בין 0 ל-24)', true);
        f.hours = h;
        await run(() => api('submitEntry', f), 'נשלח לאישור ✓');
        closeSheet();
        state.month = f.date.slice(0, 7);
        loadMine();
      };
    });
  }

  /* ================= admin ================= */
  async function loadAdmin() {
    const main = document.getElementById('main');
    if (!state.admin || state.admin.month !== state.adminMonth) main.innerHTML = '<div class="boot" style="min-height:40vh"><div class="spinner"></div></div>';
    else renderAdmin();
    try {
      state.admin = await api('adminData', { month: state.adminMonth });
      if (state.view === 'admin') renderAdmin();
      updateBadge();
    } catch (e) {
      main.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    }
  }
  function updateBadge() {
    const btn = document.querySelector('.bottomnav button[data-v="admin"]');
    if (!btn || !state.admin) return;
    const n = state.admin.pending.length + state.admin.users.filter((u) => u.status === 'ממתין').length;
    const old = btn.querySelector('.badge'); if (old) old.remove();
    if (n) btn.insertAdjacentHTML('beforeend', `<span class="badge">${n}</span>`);
  }

  function renderAdmin() {
    const a = state.admin;
    const main = document.getElementById('main');
    if (!main || !a) return;
    const reqs = a.users.filter((u) => u.status === 'ממתין');
    const approvedUsers = a.users.filter((u) => u.status === 'מאושר').sort((x, y) => x.tab.localeCompare(y.tab, 'he'));
    const total = a.summary ? a.summary.reduce((s, r) => s + r.hours, 0) : 0;

    main.innerHTML = `
      <div class="section-title"><span>דיווחים ממתינים (${a.pending.length})</span>
        ${a.pending.length > 1 ? '<button class="linkbtn" id="all">אישור הכול</button>' : ''}</div>
      ${a.pending.length ? a.pending.map((e) => entryCard(e, {
        who: true,
        actions: `<div class="actions"><button class="btn small ok" data-ok="${esc(e.id)}">אישור</button><button class="btn small danger" data-no="${esc(e.id)}">דחייה</button></div>`,
      })).join('') : '<div class="card empty">אין דיווחים שממתינים לאישור 👍</div>'}

      ${reqs.length ? `
        <div class="section-title">בקשות הצטרפות (${reqs.length})</div>
        <div class="card list">${reqs.map((u) => `
          <div class="item">
            <div class="grow"><div class="ttl">${esc(u.tab)}</div><div class="sub">${esc(u.name)} · ${esc(u.email)}</div></div>
            <button class="btn small ok" data-uok="${esc(u.email)}">אישור</button>
            <button class="btn small danger" data-uno="${esc(u.email)}">דחייה</button>
          </div>`).join('')}</div>` : ''}

      <div class="section-title">סיכום חודשי</div>
      <div class="card">
        ${monthbar(a.month, 'adm')}
        ${a.summary ? `
          <table class="summary">
            <thead><tr><th>משתתף</th><th style="text-align:end">דיווחים</th><th style="text-align:end">שעות</th></tr></thead>
            <tbody>${a.summary.map((r) => `<tr><td>${esc(r.tab)}${r.email ? '' : ' <span class="muted small">(לא משויך)</span>'}</td><td class="n num">${r.count}</td><td class="n num">${fmtH(r.hours)}</td></tr>`).join('')}</tbody>
            <tfoot><tr><td>סה״כ</td><td></td><td class="n num">${fmtH(total)}</td></tr></tfoot>
          </table>` : `<div class="empty">אין קובץ ל${monthLabel(a.month)}.<br><button class="btn primary small" id="mkthis" style="margin-top:10px">יצירת קובץ לחודש הזה</button></div>`}
      </div>

      <div class="section-title">משתתפים מאושרים (${approvedUsers.length})</div>
      <div class="card list">${approvedUsers.length ? approvedUsers.map((u) => `
        <div class="item">
          <div class="grow"><div class="ttl">${esc(u.tab)}</div><div class="sub">${esc(u.email)}</div></div>
          <button class="btn small ghost" data-urm="${esc(u.email)}">ביטול שיוך</button>
        </div>`).join('') : '<div class="empty">עדיין אין</div>'}</div>

      <div class="section-title">מנהלים</div>
      <div class="card list">
        ${a.owners.map((o) => `
          <div class="item">
            <div class="grow"><div class="ttl" style="font-weight:600">${esc(o.email)}</div></div>
            ${a.owners.length > 1 ? `<button class="btn small ghost" data-orm="${esc(o.email)}">הסרה</button>` : ''}
          </div>`).join('')}
        <form id="addo" style="display:flex;gap:8px;margin-top:12px">
          <input class="input" type="email" name="email" placeholder="מייל של מנהל נוסף" required dir="ltr" style="flex:1">
          <button class="btn primary" type="submit">הוספה</button>
        </form>
      </div>

      <div class="section-title">חודשים</div>
      <div class="card list">
        ${a.months.map((m) => `
          <div class="item">
            <div class="grow"><div class="ttl">${monthLabel(m.month)}</div></div>
            <a class="linkbtn" href="${esc(m.url)}" target="_blank" rel="noopener">פתיחת הקובץ</a>
          </div>`).join('')}
        <div class="actions"><button class="btn ghost" id="newm">פתיחת חודש חדש</button></div>
      </div>

      <div class="section-title">הגדרות</div>
      <div class="card">
        <label class="switch"><span><b>התראות במייל</b><br><span class="muted small">מייל למנהלים על כל דיווח ובקשה חדשה, ולמשתתפים על אישור/דחייה</span></span>
          <input type="checkbox" id="mail" ${a.settings.emailNotifications ? 'checked' : ''}></label>
      </div>
    `;

    bindMonthbar('adm', (d) => { state.adminMonth = shiftMonth(state.adminMonth, d); loadAdmin(); });

    const all = document.getElementById('all');
    if (all) all.onclick = () => confirmSheet(`לאשר ${a.pending.length} דיווחים?`, 'כל הדיווחים ייכתבו לגיליון.', 'אישור הכול', async () => {
      const r = await run(() => api('approveMany', { ids: a.pending.map((p) => p.id) }));
      toast(r.errors.length ? `אושרו ${r.done}. שגיאות: ${r.errors[0]}` : `אושרו ${r.done} דיווחים`, !!r.errors.length);
      loadAdmin();
    });
    main.querySelectorAll('[data-ok]').forEach((b) => {
      b.onclick = async () => { await run(() => api('decideEntry', { id: b.dataset.ok, approve: true }), 'אושר ונכתב לגיליון'); loadAdmin(); };
    });
    main.querySelectorAll('[data-no]').forEach((b) => {
      b.onclick = () => openSheet(`
        <h2>דחיית דיווח</h2>
        <form id="rj"><label class="field"><span>סיבה (תישלח למשתתף)</span><textarea class="input" name="reason" maxlength="200"></textarea></label>
        <button class="btn danger block" type="submit">דחייה</button></form>`, (root) => {
        root.querySelector('#rj').onsubmit = async (ev) => {
          ev.preventDefault();
          await run(() => api('decideEntry', { id: b.dataset.no, approve: false, reason: ev.target.reason.value }), 'נדחה');
          closeSheet(); loadAdmin();
        };
      });
    });
    main.querySelectorAll('[data-uok]').forEach((b) => {
      b.onclick = async () => { await run(() => api('decideUser', { email: b.dataset.uok, approve: true }), 'אושר'); loadAdmin(); };
    });
    main.querySelectorAll('[data-uno]').forEach((b) => {
      b.onclick = async () => { await run(() => api('decideUser', { email: b.dataset.uno, approve: false }), 'נדחה'); loadAdmin(); };
    });
    main.querySelectorAll('[data-urm]').forEach((b) => {
      b.onclick = () => confirmSheet('לבטל את השיוך?', `${b.dataset.urm} לא יוכל לדווח עד שיבחר שם ויאושר שוב.`, 'ביטול שיוך', async () => {
        await run(() => api('removeUser', { email: b.dataset.urm }), 'השיוך בוטל'); loadAdmin();
      }, true);
    });
    main.querySelectorAll('[data-orm]').forEach((b) => {
      b.onclick = () => confirmSheet('להסיר מנהל?', b.dataset.orm, 'הסרה', async () => {
        await run(() => api('removeOwner', { email: b.dataset.orm }), 'הוסר');
        if (b.dataset.orm === state.me.email) return boot();
        loadAdmin();
      }, true);
    });
    document.getElementById('addo').onsubmit = async (ev) => {
      ev.preventDefault();
      await run(() => api('addOwner', { email: ev.target.email.value.trim() }), 'מנהל נוסף');
      loadAdmin();
    };
    document.getElementById('mail').onchange = (ev) => run(() => api('setSetting', { key: 'emailNotifications', value: ev.target.checked }), 'נשמר');
    document.getElementById('newm').onclick = () => newMonthSheet();
    const mk = document.getElementById('mkthis');
    if (mk) mk.onclick = () => newMonthSheet(a.month);
  }

  function newMonthSheet(ym) {
    const months = state.admin.months.map((m) => m.month).sort();
    const def = ym || (months.length ? shiftMonth(months[months.length - 1], 1) : state.me.currentMonth);
    openSheet(`
      <h2>פתיחת חודש חדש</h2>
      <form id="nm">
        <label class="field"><span>חודש</span><input class="input" type="month" name="month" value="${def}" required></label>
        <p class="muted small">יצירה אוטומטית מעתיקה את הקובץ של החודש האחרון, מנקה את השעות ומעדכנת את התאריכים בכל הלשוניות. הקובץ החדש יופיע ב-Drive של מי שהתקין את המערכת.</p>
        <button class="btn primary block" type="submit">יצירה אוטומטית</button>
      </form>
      <div class="section-title">או – קישור לקובץ שכבר הכנתם</div>
      <form id="lm">
        <label class="field"><span>קישור לגיליון</span><input class="input" name="url" dir="ltr" placeholder="https://docs.google.com/spreadsheets/d/..." required></label>
        <button class="btn ghost block" type="submit">קישור לחודש שנבחר</button>
      </form>`, (root) => {
      root.querySelector('#nm').onsubmit = async (ev) => {
        ev.preventDefault();
        await run(() => api('createMonth', { month: ev.target.month.value }), 'הקובץ נוצר');
        closeSheet(); state.adminMonth = ev.target.month.value; loadAdmin();
      };
      root.querySelector('#lm').onsubmit = async (ev) => {
        ev.preventDefault();
        const month = root.querySelector('#nm').month.value;
        await run(() => api('linkMonth', { month, url: ev.target.url.value.trim() }), 'הקובץ קושר');
        closeSheet(); state.adminMonth = month; loadAdmin();
      };
    });
  }

  /* ================= bottom sheet ================= */
  function openSheet(html, bind) {
    $sheet.innerHTML = `<div class="overlay"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
    const ov = $sheet.firstElementChild;
    ov.addEventListener('click', (e) => { if (e.target === ov) closeSheet(); });
    if (bind) bind(ov);
    const first = ov.querySelector('input:not([type=date]):not([type=hidden]), textarea');
    if (first && !first.value && first.type !== 'time') setTimeout(() => first.focus(), 50);
  }
  function closeSheet() { $sheet.innerHTML = ''; }
  function confirmSheet(title, text, okLabel, onOk, danger) {
    openSheet(`<h2>${esc(title)}</h2>${text ? `<p class="muted">${esc(text)}</p>` : ''}
      <div class="actions"><button class="btn ghost" id="cn">ביטול</button><button class="btn ${danger ? 'danger' : 'primary'}" id="okb">${esc(okLabel)}</button></div>`, (root) => {
      root.querySelector('#cn').onclick = closeSheet;
      root.querySelector('#okb').onclick = async () => { closeSheet(); try { await onOk(); } catch (e) { /* toast shown */ } };
    });
  }

  /* ================= start ================= */
  // רענון כשחוזרים לאפליקציה
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state.me || $sheet.innerHTML) return;
    if (!DEMO && !loadToken()) return signOut(true);
    if (state.view === 'admin' && state.me.isOwner) loadAdmin();
    else if (state.me.link && state.me.link.status === 'מאושר') loadMine();
  });

  if ('serviceWorker' in navigator && !DEMO) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  boot();
})();
