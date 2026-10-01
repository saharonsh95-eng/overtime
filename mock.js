// מצב הדגמה: נטען כשאין API_URL בהגדרות או כשמוסיפים ?demo לכתובת.
// ?demo=owner (ברירת מחדל) | ?demo=member | ?demo=new
(function () {
  const pad = (n) => String(n).padStart(2, '0');
  const today = new Date();
  const ym = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
  const d = (day) => `${ym}-${pad(day)}`;
  const TABS = ['יעקב משיטו', 'שי בן סימון', 'יובל ברק', 'ראג׳א חמזה', 'אסף הרוש', 'יוסף כיוף',
    'סולימאן שחידם', 'עדי שגיא', 'שרון קפיאן', 'מטבי מטבייב'];

  const role = new URLSearchParams(location.search).get('demo') || 'owner';
  const me = {
    owner: { email: 'yaakov@example.com', name: 'יעקב משיטו' },
    member: { email: 'yuval@example.com', name: 'יובל ברק' },
    new: { email: 'new@example.com', name: 'משתמש חדש' },
  }[role] || { email: 'yaakov@example.com', name: 'יעקב משיטו' };

  const db = {
    owners: [{ email: 'yaakov@example.com', addedBy: 'setup', addedAt: '' }],
    users: [
      { email: 'yaakov@example.com', tab: 'יעקב משיטו', status: 'מאושר', name: 'יעקב משיטו' },
      { email: 'yuval@example.com', tab: 'יובל ברק', status: 'מאושר', name: 'יובל ברק' },
      { email: 'shai@example.com', tab: 'שי בן סימון', status: 'מאושר', name: 'שי בן סימון' },
      { email: 'asaf@example.com', tab: 'אסף הרוש', status: 'ממתין', name: 'אסף הרוש' },
    ],
    reports: [
      { id: 'r1', email: 'yuval@example.com', name: 'יובל ברק', tab: 'יובל ברק', date: d(3), start: '07:00', end: '21:30', hours: 4.5, note: 'שריפה ברחוב הרצל', status: 'ממתין' },
      { id: 'r2', email: 'shai@example.com', name: 'שי בן סימון', tab: 'שי בן סימון', date: d(4), start: '19:00', end: '09:00', hours: 2, note: '', status: 'ממתין' },
      { id: 'r3', email: 'yuval@example.com', name: 'יובל ברק', tab: 'יובל ברק', date: d(1), start: '07:00', end: '20:00', hours: 3, note: 'החלפה', status: 'נדחה', reason: 'כבר דווח ע"י המשמרת' },
    ],
    sheet: {
      'יעקב משיטו': [{ date: d(1), start: '07:00', end: '22:00', hours: 5, note: 'תרגיל' }],
      'יובל ברק': [{ date: d(2), start: '07:00', end: '19:30', hours: 2.5, note: '' }],
      'שי בן סימון': [{ date: d(2), start: '07:00', end: '19:00', hours: 2, note: '' }, { date: d(5), start: '19:00', end: '10:00', hours: 3, note: 'אירוע חומ"ס' }],
    },
    months: [{ month: ym, id: 'demo', url: '#' }],
    email: true,
  };
  if (role === 'new') db.users = db.users.filter((u) => u.email !== me.email);

  const linkOf = (e) => { const u = db.users.find((x) => x.email === e); return u ? { tab: u.tab, status: u.status } : null; };
  const isOwner = (e) => db.owners.some((o) => o.email === e);
  const sum = (a) => a.reduce((s, x) => s + Number(x.hours || 0), 0);
  const fail = (m) => { throw new Error(m); };

  const A = {
    whoami: () => {
      const link = linkOf(me.email);
      const r = { ...me, picture: '', isOwner: isOwner(me.email), link, months: db.months.map((m) => m.month), currentMonth: ym };
      if (!link || link.status !== 'מאושר') {
        const taken = new Set(db.users.filter((u) => u.status === 'מאושר').map((u) => u.tab));
        r.tabs = TABS.map((t) => ({ tab: t, taken: taken.has(t) }));
      }
      return r;
    },
    requestLink: ({ tab }) => {
      db.users = db.users.filter((u) => u.email !== me.email);
      db.users.push({ email: me.email, tab, status: 'ממתין', name: me.name });
      return linkOf(me.email);
    },
    submitEntry: (p) => {
      const l = linkOf(me.email);
      if (!l || l.status !== 'מאושר') fail('החשבון עדיין לא אושר');
      if (!(Number(p.hours) > 0)) fail('מספר השעות הנוספות צריך להיות בין 0 ל-24');
      const r = { ...p, hours: Number(p.hours), id: 'r' + Date.now(), email: me.email, name: me.name, tab: l.tab, status: 'ממתין' };
      db.reports.push(r);
      return r;
    },
    myEntries: ({ month }) => {
      const l = linkOf(me.email);
      const mine = db.reports.filter((r) => r.email === me.email && r.date.startsWith(month));
      const approved = (db.sheet[l.tab] || []).filter((r) => r.date.startsWith(month)).map((r) => ({ ...r, status: 'מאושר' }));
      const pending = mine.filter((r) => r.status === 'ממתין');
      return { month, tab: l.tab, missingFile: !db.months.some((m) => m.month === month), approved, pending,
        rejected: mine.filter((r) => r.status === 'נדחה'), totals: { approved: sum(approved), pending: sum(pending) } };
    },
    deletePending: ({ id }) => { db.reports = db.reports.filter((r) => r.id !== id); return true; },
    adminData: ({ month }) => {
      const byTab = {}; db.users.forEach((u) => { if (u.status === 'מאושר') byTab[u.tab] = u.email; });
      const has = db.months.some((m) => m.month === month);
      return {
        month, users: db.users, owners: db.owners, months: db.months,
        pending: db.reports.filter((r) => r.status === 'ממתין').sort((a, b) => a.date.localeCompare(b.date)),
        summary: has ? TABS.map((t) => { const rows = (db.sheet[t] || []).filter((r) => r.date.startsWith(month)); return { tab: t, email: byTab[t] || '', count: rows.length, hours: sum(rows) }; }) : null,
        settings: { emailNotifications: db.email },
      };
    },
    decideUser: ({ email, approve }) => { const u = db.users.find((x) => x.email === email); u.status = approve ? 'מאושר' : 'נדחה'; return true; },
    removeUser: ({ email }) => { db.users = db.users.filter((u) => u.email !== email); return true; },
    decideEntry: ({ id, approve, reason }) => {
      const r = db.reports.find((x) => x.id === id);
      r.status = approve ? 'מאושר' : 'נדחה'; r.reason = reason || '';
      if (approve) (db.sheet[r.tab] = db.sheet[r.tab] || []).push({ ...r });
      return true;
    },
    approveMany: ({ ids }) => { ids.forEach((id) => A.decideEntry({ id, approve: true })); return { done: ids.length, errors: [] }; },
    addOwner: ({ email }) => { if (!/@/.test(email)) fail('מייל לא תקין'); db.owners.push({ email, addedBy: me.email }); return true; },
    removeOwner: ({ email }) => { if (db.owners.length <= 1) fail('חייב להישאר לפחות מנהל אחד'); db.owners = db.owners.filter((o) => o.email !== email); return true; },
    setSetting: ({ value }) => { db.email = !!value; return true; },
    createMonth: ({ month }) => { if (db.months.some((m) => m.month === month)) fail('כבר קיים קובץ לחודש הזה'); const r = { month, id: 'x', url: '#' }; db.months.push(r); return r; },
    linkMonth: ({ month, url }) => { const r = { month, id: 'y', url }; db.months.push(r); return r; },
  };

  window.MockAPI = {
    user: me,
    call: (action, payload) => new Promise((res, rej) => {
      setTimeout(() => {
        try { res(JSON.parse(JSON.stringify(A[action](payload || {})))); } catch (e) { rej(e); }
      }, 250);
    }),
  };
})();
