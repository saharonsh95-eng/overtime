/* שעות נוספות – PWA */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const DEMO = new URLSearchParams(location.search).has('demo') || !/^https:\/\//.test(CFG.API_URL || '');
  const SESSION_KEY = 'ot_session';  // התחברות שנשמרת במכשיר (כמה חודשים)
  const HEB_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  const HEB_DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

  const state = {
    session: null,
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

  const ICON = {
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5" stroke-linecap="round"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
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
  async function api(action, payload, extra) {
    if (DEMO) return window.MockAPI.call(action, payload);
    let res;
    try {
      res = await fetch(CFG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // מונע preflight מול Apps Script
        body: JSON.stringify({ action, payload: payload || {}, session: state.session, idToken: extra && extra.idToken }),
      });
    } catch (e) {
      throw new Error('אין חיבור לאינטרנט');
    }
    const j = await res.json().catch(() => ({ ok: false, error: 'תגובה לא תקינה מהשרת' }));
    if (!j.ok) {
      const err = new Error(j.error || 'שגיאה');
      err.code = j.code;
      if (j.code === 'AUTH' && !(extra && extra.idToken)) { signOut(true); }
      throw err;
    }
    if (j.session) saveSession(j.session);   // השרת מאריך את ההתחברות בכל כניסה
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
  function loadSession() {
    try { return localStorage.getItem(SESSION_KEY) || null; } catch (e) { return null; }
  }
  function saveSession(t) {
    state.session = t;
    try { localStorage.setItem(SESSION_KEY, t); } catch (e) { /* ignore */ }
  }

  // אחרי התחברות עם Google: מחליפים את הטוקן הקצר (שעה) בהתחברות ארוכה של האפליקציה
  async function onCredential(resp) {
    busy(true);
    try {
      const r = await api('login', {}, { idToken: resp.credential });
      saveSession(r.session);
      boot();
    } catch (e) {
      toast(e.message, true);
    } finally {
      busy(false);
    }
  }

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
      callback: onCredential,
      auto_select: true,
      cancel_on_tap_outside: false,
      itp_support: true,
      use_fedcm_for_prompt: true,
    });
    gisReady = true;
  }

  function signOut(expired) {
    state.session = null; state.me = null;
    try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem('ot_token'); } catch (e) { /* ignore */ }
    if (!expired && window.google && google.accounts) google.accounts.id.disableAutoSelect();
    renderLogin(expired);
  }

  /* ================= boot ================= */
  async function boot() {
    if (!DEMO && !state.session) state.session = loadSession();
    if (!DEMO && !state.session) return renderLogin();
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
          <p class="muted">ביקשת להשתייך ל<b>${esc(me.link.tab)}</b>${me.link.isNew ? ' (שם חדש)' : ''}.<br>אחרי שמנהל יאשר, אפשר יהיה לדווח שעות.</p>
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
          ${tabs.map((t, i) => `<button data-i="${i}" ${t.taken ? 'disabled' : ''}>${esc(t.tab)}${t.taken ? '<small>כבר משויך</small>' : ''}</button>`).join('')}
        </div>
        <div class="card" style="margin-top:16px">
          <b>השם שלי לא ברשימה</b>
          <p class="muted small" style="margin:4px 0 10px">אפשר להוסיף שם חדש. אחרי אישור המנהל תיפתח לך לשונית חדשה בגיליון.</p>
          <form id="nn" style="display:flex;gap:8px">
            <input class="input" name="name" placeholder="שם מלא" maxlength="40" required style="flex:1">
            <button class="btn primary" type="submit">שליחה</button>
          </form>
        </div>`;
    }
    $app.innerHTML = topbar() + `<main>${body}</main>`;
    bindTopbar();
    const tabs = me.tabs || [];
    $app.querySelectorAll('.pick button[data-i]').forEach((b) => {
      const tab = tabs[Number(b.dataset.i)].tab;
      b.onclick = () => confirmSheet(`להשתייך ל"${tab}"?`, 'הבקשה תישלח למנהל לאישור.', 'שליחה', async () => {
        await run(() => api('requestLink', { tab }), 'הבקשה נשלחה');
        boot();
      });
    });
    const nn = document.getElementById('nn');
    if (nn) nn.onsubmit = (ev) => {
      ev.preventDefault();
      const name = ev.target.name.value.trim();
      if (name.length < 2) return toast('יש לכתוב שם', true);
      confirmSheet(`להוסיף את השם "${name}"?`, 'אחרי אישור המנהל תיפתח לשונית חדשה בשם הזה.', 'שליחה', async () => {
        await run(() => api('requestLink', { newName: name }), 'הבקשה נשלחה');
        boot();
      });
    };
    const chk = document.getElementById('chk');
    if (chk) chk.onclick = () => run(boot);
    const chg = document.getElementById('chg');
    if (chg) chg.onclick = async () => { await run(async () => { state.me = await api('whoami'); }); renderLink(true); };
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
    const pendingCount = requestsCount();
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
      main.innerHTML = `<div class="card"><b>ממתין לאישור</b><p class="muted small">ביקשת להשתייך ל"${esc(l.tab)}". אפשר לאשר בלשונית ניהול.</p></div>`;
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

  const catsList = () => (state.mine && state.mine.categories) || (state.me && state.me.categories) || ['חופש', 'מחלה', 'סיור לימודי'];
  const catSummary = (cats) => Object.keys(cats || {}).map((c) => `<span class="chip vac">${esc(c)} · ${cats[c].days} ${cats[c].days === 1 ? 'יום' : 'ימים'}</span>`).join(' ');

  function entryCard(e, actions) {
    const day = dayOf(e.date);
    const h = Number(e.hours);
    return `
      <div class="card entry">
        <div class="day"><b>${day.d}</b><span>יום ${day.w}</span></div>
        <div class="body">
          <div class="row1">
            ${e.cat ? `<span class="chip vac">${esc(e.cat)}</span>` : ''}
            ${h ? `<span class="hours"><span class="num">${fmtH(h)}</span> ש׳</span>` : ''}
            ${e.start || e.end ? `<span class="times num">${esc(e.start)}–${esc(e.end)}</span>` : ''}
          </div>
          ${e.note && e.note !== e.cat ? `<div class="note">${esc(e.note)}</div>` : ''}
        </div>
        ${actions || ''}
      </div>`;
  }

  const entryText = (e) => [fmtDate(e.date), e.start ? `${e.start}–${e.end}` : '', Number(e.hours) ? `${fmtH(e.hours)} שעות` : '', e.note].filter(Boolean).join(' · ');

  function renderMine() {
    const m = state.mine;
    const main = document.getElementById('main');
    if (!main || !m) return;
    const all = m.entries.slice().sort((a, b) => b.date.localeCompare(a.date) || b.start.localeCompare(a.start));
    const cats = catSummary(m.totals.cats);
    main.innerHTML = `
      ${monthbar(m.month, 'mine')}
      ${m.missingFile ? `<div class="banner">${m.canCreate ? 'החודש הזה ייפתח אוטומטית בדיווח הראשון.' : 'אין קובץ לחודש הזה.'}</div>` : ''}
      <div class="stats">
        <div class="stat ok"><div class="v num">${fmtH(m.totals.hours)}</div><div class="k">שעות נוספות</div></div>
        <div class="stat"><div class="v num">${m.totals.count}</div><div class="k">דיווחים</div></div>
      </div>
      ${cats ? `<div class="catrow">${cats}</div>` : ''}
      <div class="section-title">הדיווחים שלי</div>
      ${all.length ? all.map((e, i) => entryCard(e, `
        <div class="acts">
          <button class="iconbtn" data-edit="${i}" aria-label="עריכה">${ICON.edit}</button>
          <button class="iconbtn del" data-del="${i}" aria-label="מחיקה">${ICON.trash}</button>
        </div>`)).join('')
        : '<div class="empty">אין דיווחים בחודש הזה</div>'}
    `;
    bindMonthbar('mine', (d) => { state.month = shiftMonth(state.month, d); loadMine(); });
    main.querySelectorAll('[data-del]').forEach((b) => {
      const e = all[Number(b.dataset.del)];
      b.onclick = () => confirmSheet('למחוק את הדיווח?', `${entryText(e)}. השורה תימחק גם מהגיליון.`, 'מחיקה', async () => {
        await run(() => api('deleteEntry', { month: m.month, row: e.row, sig: e.sig }), 'נמחק');
        loadMine();
      }, true);
    });
    main.querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = () => entryForm('one', all[Number(b.dataset.edit)]);
    });
  }

  const diffHours = (a, b) => {
    const t = (x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5));
    let d = t(b) - t(a);
    if (d <= 0) d += 1440;
    return Math.round(d / 60 * 100) / 100;
  };
  const catChips = (id) => `<div class="qchips" data-for="${id}">${catsList().map((c) => `<button type="button" class="qchip" data-q="${esc(c)}">${esc(c)}</button>`).join('')}</div>`;
  const bindChips = (root, input) => root.querySelectorAll('.qchip').forEach((b) => {
    b.onclick = () => { input.value = b.dataset.q; input.dispatchEvent(new Event('input')); };
  });

  // edit = דיווח קיים לעריכה (אז אין לשוניות)
  function entryForm(mode, edit) {
    mode = edit ? 'one' : (mode || 'one');
    const defDate = edit ? edit.date : (state.month === todayISO().slice(0, 7) ? todayISO() : `${state.month}-01`);
    const tabs = edit ? '<h2>עריכת דיווח</h2>' : `
      <div class="seg" role="tablist">
        <button type="button" data-mode="one" class="${mode === 'one' ? 'on' : ''}">דיווח</button>
        <button type="button" data-mode="multi" class="${mode === 'multi' ? 'on' : ''}">כמה ימים</button>
      </div>`;
    const bindTabs = (root) => root.querySelectorAll('[data-mode]').forEach((b) => {
      b.onclick = () => { if (b.dataset.mode !== mode) entryForm(b.dataset.mode); };
    });
    if (mode === 'multi') return multiForm(tabs, bindTabs);
    const full = !!(edit && edit.start === '07:00' && edit.end === '07:00' && Number(edit.hours) === 24);
    openSheet(`
      ${tabs}
      <form id="ef" novalidate>
        <label class="field"><span>תאריך</span><input class="input" type="date" name="date" value="${esc(defDate)}" required></label>
        <label class="check"><input type="checkbox" name="full" ${full ? 'checked' : ''}> <span><b>משמרת מלאה</b> <span class="muted small">(07:00–07:00, 24 שעות)</span></span></label>
        <div class="grid2">
          <label class="field"><span>שעת כניסה</span><input class="input" type="time" name="start" value="${esc(edit ? edit.start : '')}"></label>
          <label class="field"><span>שעת יציאה</span><input class="input" type="time" name="end" value="${esc(edit ? edit.end : '')}"></label>
        </div>
        <label class="field"><span>שעות נוספות <span class="muted small" id="hh">(מחושב אוטומטית לפי השעות, אפשר לשנות)</span></span>
          <input class="input" type="number" inputmode="decimal" step="0.25" min="0" max="24" name="hours" value="${esc(edit && Number(edit.hours) ? edit.hours : '')}" placeholder="לא חובה"></label>
        <label class="field"><span>הערה</span>
          ${catChips('note')}
          <textarea class="input" name="note" maxlength="300" placeholder="לא חובה: אירוע, החלפה, חופש, מחלה...">${esc(edit ? edit.note : '')}</textarea></label>
        <p class="muted small" style="margin:-6px 2px 12px">הערה שמכילה ${catsList().map(esc).join(' / ')} לא נספרת בשעות הנוספות.</p>
        <button class="btn primary block" type="submit">${edit ? 'שמירת שינויים' : 'שמירה'}</button>
      </form>`, (root) => {
      bindTabs(root);
      const f = root.querySelector('#ef');
      let manual = !!(edit && Number(edit.hours) && !(edit.start && diffHours(edit.start, edit.end) === Number(edit.hours)));
      const syncFull = () => {
        const on = f.full.checked;
        if (on) { f.start.value = '07:00'; f.end.value = '07:00'; f.hours.value = 24; manual = false; }
        f.start.disabled = f.end.disabled = f.hours.disabled = on;
      };
      const autoCalc = () => {
        if (manual || f.full.checked) return;
        f.hours.value = f.start.value && f.end.value ? diffHours(f.start.value, f.end.value) : '';
      };
      f.full.onchange = syncFull;
      f.start.oninput = f.end.oninput = autoCalc;
      f.hours.oninput = () => { manual = f.hours.value !== ''; };
      bindChips(root, f.note);
      syncFull();
      f.onsubmit = async (ev) => {
        ev.preventDefault();
        const p = { date: f.date.value, start: f.start.value, end: f.end.value, hours: '', note: f.note.value.trim(), fullShift: f.full.checked };
        if (!p.date) return toast('יש לבחור תאריך', true);
        if (!!p.start !== !!p.end) return toast('יש למלא גם שעת כניסה וגם שעת יציאה (או להשאיר ריק)', true);
        const raw = String(f.hours.value).trim().replace(',', '.');
        if (!p.fullShift && raw !== '' && Number(raw) !== 0) {
          const h = Number(raw);
          if (!(h > 0 && h <= 24)) return toast('מספר השעות צריך להיות בין 0 ל-24', true);
          p.hours = h;
        }
        if (!p.fullShift && !p.start && p.hours === '' && !p.note) return toast('יש למלא שעות, משמרת מלאה או הערה', true);
        if (edit) await run(() => api('updateEntry', { month: state.mine.month, row: edit.row, sig: edit.sig, entry: p }), 'עודכן ✓');
        else await run(() => api('submitEntry', p), 'נשמר בגיליון ✓');
        closeSheet();
        state.month = p.date.slice(0, 7);
        loadMine();
      };
    });
  }

  // כמה ימים בבת אחת: בוחרים ימים בלוח, הערה חופשית, ושעות לבחירה
  function multiForm(tabs, bindTabs) {
    const picked = new Set();
    let calMonth = state.month;
    let hoursMode = 'none';
    let hoursVal = '';
    let noteVal = '';
    const busyDays = new Set(((state.mine && state.mine.entries) || []).map((e) => e.date));

    const calendar = () => {
      const [y, m] = calMonth.split('-').map(Number);
      const first = new Date(y, m - 1, 1).getDay();
      const days = new Date(y, m, 0).getDate();
      let cells = HEB_DAYS.map((d) => `<div class="cal-h">${d}</div>`).join('');
      for (let i = 0; i < first; i++) cells += '<div></div>';
      for (let d = 1; d <= days; d++) {
        const iso = `${calMonth}-${pad(d)}`;
        cells += `<button type="button" class="cal-d${picked.has(iso) ? ' on' : ''}${iso === todayISO() ? ' today' : ''}" data-d="${iso}">${d}${busyDays.has(iso) ? '<i></i>' : ''}</button>`;
      }
      return `
        <div class="monthbar cal-bar">
          <button type="button" class="iconbtn" data-cm="-1" aria-label="חודש קודם">${ICON.prev}</button>
          <div class="label">${monthLabel(calMonth)}</div>
          <button type="button" class="iconbtn" data-cm="1" aria-label="חודש הבא">${ICON.next}</button>
        </div>
        <div class="cal">${cells}</div>`;
    };

    openSheet(`
      ${tabs}
      <p class="muted small" style="margin:0 0 8px">מסמנים בלוח את כל הימים, וכותבים הערה אחת לכולם (חופש, מחלה, סיור לימודי או כל דבר אחר).</p>
      <div id="calwrap">${calendar()}</div>
      <div class="muted small" id="pc" style="margin:8px 2px 14px">לא נבחרו ימים</div>
      <label class="field"><span>הערה לכל הימים</span>
        ${catChips('mnote')}
        <input class="input" id="mnote" maxlength="300" placeholder="למשל: חופש"></label>
      <div class="field"><span class="lbl">שעות נוספות לכל יום</span>
        <div class="radios">
          <label><input type="radio" name="hm" value="none" checked> ריק</label>
          <label><input type="radio" name="hm" value="full"> משמרת מלאה (24)</label>
          <label><input type="radio" name="hm" value="num"> מספר:</label>
          <input class="input small-in" type="number" inputmode="decimal" step="0.25" min="0" max="24" id="vh" disabled>
        </div>
      </div>
      <button class="btn primary block" id="vs" type="button">שמירה</button>`, (root) => {
      bindTabs(root);
      const sync = () => {
        root.querySelector('#calwrap').innerHTML = calendar();
        root.querySelector('#pc').textContent = picked.size ? `נבחרו ${picked.size} ימים` : 'לא נבחרו ימים';
        bindCal();
      };
      const bindCal = () => {
        root.querySelectorAll('[data-d]').forEach((b) => {
          b.onclick = () => { const d = b.dataset.d; picked.has(d) ? picked.delete(d) : picked.add(d); sync(); };
        });
        root.querySelectorAll('[data-cm]').forEach((b) => {
          b.onclick = () => { calMonth = shiftMonth(calMonth, Number(b.dataset.cm)); sync(); };
        });
      };
      bindCal();
      const note = root.querySelector('#mnote');
      note.oninput = () => { noteVal = note.value; };
      bindChips(root, note);
      const vh = root.querySelector('#vh');
      root.querySelectorAll('input[name=hm]').forEach((r) => {
        r.onchange = () => { hoursMode = r.value; vh.disabled = hoursMode !== 'num'; if (hoursMode === 'num') vh.focus(); };
      });
      vh.oninput = () => { hoursVal = vh.value; };
      root.querySelector('#vs').onclick = async () => {
        if (!picked.size) return toast('יש לבחור לפחות יום אחד', true);
        const p = { dates: [...picked].sort(), note: noteVal.trim(), hours: '', fullShift: hoursMode === 'full' };
        if (hoursMode === 'num') {
          const h = Number(String(hoursVal).trim().replace(',', '.'));
          if (!(h > 0 && h <= 24)) return toast('מספר השעות צריך להיות בין 0 ל-24', true);
          p.hours = h;
        }
        if (!p.note && hoursMode === 'none') return toast('יש לכתוב הערה (למשל חופש) או לבחור שעות', true);
        const r = await run(() => api('submitVacation', p));
        toast(r.skipped ? `נשמרו ${r.added} ימים (${r.skipped} כבר היו רשומים)` : `נשמרו ${r.added} ימים ✓`);
        closeSheet();
        state.month = p.dates[0].slice(0, 7);
        loadMine();
      };
    });
  }

  /* ================= admin ================= */
  const requestsCount = () => (state.admin ? state.admin.users.filter((u) => u.status === 'ממתין').length : 0);

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
    const n = requestsCount();
    const old = btn.querySelector('.badge'); if (old) old.remove();
    if (n) btn.insertAdjacentHTML('beforeend', `<span class="badge">${n}</span>`);
  }

  function renderAdmin() {
    const a = state.admin;
    const main = document.getElementById('main');
    if (!main || !a) return;
    const reqs = a.users.filter((u) => u.status === 'ממתין');
    const total = a.summary ? a.summary.reduce((s, r) => s + r.hours, 0) : 0;
    const tabs = a.tabs.slice().sort((x, y) => x.tab.localeCompare(y.tab, 'he'));

    main.innerHTML = `
      ${reqs.length ? `
        <div class="section-title">בקשות הצטרפות (${reqs.length})</div>
        <div class="card list">${reqs.map((u) => `
          <div class="item">
            <div class="grow"><div class="ttl">${esc(u.tab)} ${u.newTab === 'כן' ? '<span class="chip warn">שם חדש</span>' : ''}</div><div class="sub">${esc(u.name)} · ${esc(u.email)}</div></div>
            <button class="btn small ok" data-uok="${esc(u.email)}">אישור</button>
            <button class="btn small danger" data-uno="${esc(u.email)}">דחייה</button>
          </div>`).join('')}</div>` : ''}

      <div class="section-title">סיכום חודשי</div>
      <div class="card">
        ${monthbar(a.month, 'adm')}
        ${a.summary ? `
          <table class="summary">
            <thead><tr><th>שם</th><th style="text-align:end">שעות נוספות</th></tr></thead>
            <tbody>${a.summary.map((r) => `<tr><td>${esc(r.tab)}${r.email ? '' : ' <span class="muted small">(לא משויך)</span>'}${Object.keys(r.cats || {}).length ? `<div class="catline">${Object.keys(r.cats).map((c) => `${esc(c)} ${r.cats[c].days}`).join(' · ')}</div>` : ''}</td><td class="n num">${fmtH(r.hours)}</td></tr>`).join('')}</tbody>
            <tfoot><tr><td>סה״כ</td><td class="n num">${fmtH(total)}</td></tr></tfoot>
          </table>` : `<div class="empty">אין קובץ ל${monthLabel(a.month)}.<br><button class="btn primary small" id="mkthis" style="margin-top:10px">יצירת קובץ לחודש הזה</button></div>`}
      </div>

      <div class="section-title">שמות ברשימה (${tabs.length})</div>
      <div class="card list">
        ${tabs.map((t, i) => `
          <div class="item">
            <div class="grow"><div class="ttl">${esc(t.tab)}</div><div class="sub">${t.email ? esc(t.email) : 'לא משויך'}</div></div>
            ${t.email ? `<button class="btn small ghost" data-urm="${esc(t.email)}">ביטול שיוך</button>` : ''}
            <button class="iconbtn del" data-tdel="${i}" aria-label="מחיקת שם">${ICON.trash}</button>
          </div>`).join('')}
        <form id="addt" style="display:flex;gap:8px;margin-top:12px">
          <input class="input" name="name" placeholder="הוספת שם חדש" maxlength="40" required style="flex:1">
          <button class="btn primary" type="submit">הוספה</button>
        </form>
      </div>

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
        <p class="muted small">חודש חדש נפתח אוטומטית כשמישהו מדווח עליו לראשונה. אפשר גם לפתוח ידנית:</p>
        <div class="actions" style="margin-top:4px"><button class="btn ghost" id="newm">פתיחת חודש חדש</button></div>
      </div>

      <div class="section-title">הגדרות</div>
      <div class="card">
        <label class="switch"><span><b>התראות במייל</b><br><span class="muted small">מייל למנהלים על בקשת הצטרפות, ולמשתתף כשהבקשה שלו אושרה או נדחתה</span></span>
          <input type="checkbox" id="mail" ${a.settings.emailNotifications ? 'checked' : ''}></label>
        <div style="border-top:1px solid var(--line);margin:14px 0"></div>
        <b>סוגי היעדרות</b>
        <p class="muted small" style="margin:4px 0 10px">דיווח שההערה שלו מכילה אחת מהמילים האלה נספר בנפרד ולא בשעות הנוספות. מפרידים בפסיק.</p>
        <form id="catf" style="display:flex;gap:8px">
          <input class="input" name="cats" value="${esc((a.settings.categories || []).join(', '))}" style="flex:1">
          <button class="btn primary" type="submit">שמירה</button>
        </form>
        <div style="border-top:1px solid var(--line);margin:14px 0"></div>
        <b>סידור הלשוניות</b>
        <p class="muted small" style="margin:4px 0 10px">מוודא שבכל לשונית הטבלה מתחילה ב-A1 עם העמודות: תאריך, שעת כניסה, שעת יציאה, שעות נוספות, הערה.</p>
        <button class="btn ghost block" id="norm">סידור כל הלשוניות</button>
      </div>
    `;

    bindMonthbar('adm', (d) => { state.adminMonth = shiftMonth(state.adminMonth, d); loadAdmin(); });

    main.querySelectorAll('[data-uok]').forEach((b) => {
      b.onclick = async () => { await run(() => api('decideUser', { email: b.dataset.uok, approve: true }), 'אושר'); loadAdmin(); };
    });
    main.querySelectorAll('[data-uno]').forEach((b) => {
      b.onclick = async () => { await run(() => api('decideUser', { email: b.dataset.uno, approve: false }), 'נדחה'); loadAdmin(); };
    });
    main.querySelectorAll('[data-urm]').forEach((b) => {
      b.onclick = () => confirmSheet('לבטל את השיוך?', `${b.dataset.urm} לא יוכל לדווח עד שיבחר שם ויאושר שוב. השעות בגיליון נשארות.`, 'ביטול שיוך', async () => {
        await run(() => api('removeUser', { email: b.dataset.urm }), 'השיוך בוטל'); loadAdmin();
      }, true);
    });
    main.querySelectorAll('[data-tdel]').forEach((b) => {
      const t = tabs[Number(b.dataset.tdel)];
      b.onclick = () => confirmSheet(`למחוק את "${t.tab}"?`,
        'הלשונית תימחק מהגיליון של החודש הנוכחי (והבאים, אם נפתחו), כולל השעות שבה. חודשים קודמים לא ייפגעו.' + (t.email ? ` השיוך של ${t.email} יבוטל.` : ''),
        'מחיקה', async () => {
          await run(() => api('deleteTab', { tab: t.tab }), 'השם נמחק'); loadAdmin();
        }, true);
    });
    document.getElementById('addt').onsubmit = async (ev) => {
      ev.preventDefault();
      await run(() => api('addTab', { name: ev.target.name.value.trim() }), 'נוספה לשונית חדשה');
      loadAdmin();
    };
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
    document.getElementById('catf').onsubmit = async (ev) => {
      ev.preventDefault();
      await run(() => api('setSetting', { key: 'categories', value: ev.target.cats.value }), 'נשמר');
      state.mine = null;
      loadAdmin();
    };
    document.getElementById('mail').onchange = (ev) => run(() => api('setSetting', { key: 'emailNotifications', value: ev.target.checked }), 'נשמר');
    document.getElementById('norm').onclick = async () => {
      const r = await run(() => api('normalizeTabs'));
      if (r.notes.length) {
        openSheet(`<h2>סודרו ${r.fixed} לשוניות</h2><p class="muted">כדאי לבדוק ידנית:</p><ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul><button class="btn ghost block" id="cls">סגירה</button>`,
          (root) => { root.querySelector('#cls').onclick = closeSheet; });
      } else toast(`כל ${r.fixed} הלשוניות מסודרות ✓`);
      loadAdmin();
    };
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
    if (state.view === 'admin' && state.me.isOwner) loadAdmin();
    else if (state.me.link && state.me.link.status === 'מאושר') loadMine();
  });

  if ('serviceWorker' in navigator && !DEMO) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  boot();
})();
