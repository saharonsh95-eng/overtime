// מצב הדגמה: נטען כשאין API_URL בהגדרות או כשמוסיפים ?demo לכתובת.
// ?demo=owner (ברירת מחדל) | ?demo=member | ?demo=new
(function () {
  const pad = (n) => String(n).padStart(2, '0');
  const today = new Date();
  const ym = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
  const d = (day) => `${ym}-${pad(day)}`;
  let TABS = ['יעקב משיטו', 'שי בן סימון', 'יובל ברק', 'ראג׳א חמזה', 'אסף הרוש', 'יוסף כיוף',
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
      { email: 'sahar@example.com', tab: 'סהר לוי', status: 'ממתין', name: 'Sahar', newTab: 'כן' },
    ],
    sheet: {
      'יעקב משיטו': [{ date: d(1), start: '07:00', end: '22:00', hours: 5, note: 'תרגיל' }],
      'יובל ברק': [
        { date: d(2), start: '07:00', end: '19:30', hours: 2.5, note: '' },
        { date: d(3), start: '07:00', end: '21:30', hours: 4.5, note: 'שריפה ברחוב הרצל' },
      ],
      'שי בן סימון': [{ date: d(2), start: '07:00', end: '19:00', hours: 2, note: '' }, { date: d(5), start: '19:00', end: '10:00', hours: 3, note: 'אירוע חומ"ס' }],
    },
    months: [{ month: ym, id: 'demo', url: '#' }],
    email: true,
  };
  if (role === 'new') db.users = db.users.filter((u) => u.email !== me.email);

  const linkOf = (e) => { const u = db.users.find((x) => x.email === e); return u ? { tab: u.tab, status: u.status, isNew: u.newTab === 'כן' } : null; };
  const isOwner = (e) => db.owners.some((o) => o.email === e);
  const sum = (a) => a.reduce((s, x) => s + Number(x.hours || 0), 0);
  const fail = (m) => { throw new Error(m); };
  const sig = (r) => [r.date, r.start, r.end, r.hours, r.note].join('|');
  const rowsOf = (tab, month) => (db.sheet[tab] || []).map((r, i) => ({ ...r, row: i + 2, sig: sig(r) })).filter((r) => r.date.startsWith(month));
  const taken = () => new Set(db.users.filter((u) => u.status === 'מאושר').map((u) => u.tab));

  const A = {
    whoami: () => {
      const link = linkOf(me.email);
      const r = { ...me, picture: '', isOwner: isOwner(me.email), link, months: db.months.map((m) => m.month), currentMonth: ym };
      if (!link || link.status !== 'מאושר') { const t = taken(); r.tabs = TABS.map((x) => ({ tab: x, taken: t.has(x) })); }
      return r;
    },
    requestLink: ({ tab, newName }) => {
      if (newName && TABS.includes(newName)) fail(`השם "${newName}" כבר קיים ברשימה – אפשר לבחור אותו`);
      db.users = db.users.filter((u) => u.email !== me.email);
      db.users.push({ email: me.email, tab: newName || tab, status: 'ממתין', name: me.name, newTab: newName ? 'כן' : '' });
      return linkOf(me.email);
    },
    submitEntry: (p) => {
      const l = linkOf(me.email);
      if (!l || l.status !== 'מאושר') fail('החשבון עדיין לא אושר');
      (db.sheet[l.tab] = db.sheet[l.tab] || []).push({ date: p.date, start: p.start, end: p.end, hours: Number(p.hours), note: p.note || '' });
      return true;
    },
    myEntries: ({ month }) => {
      const l = linkOf(me.email);
      const entries = rowsOf(l.tab, month);
      const has = db.months.some((m) => m.month === month);
      return { month, tab: l.tab, missingFile: !has, canCreate: !has && month > ym, entries, totals: { hours: sum(entries), count: entries.length } };
    },
    deleteEntry: ({ row, sig: s }) => {
      const l = linkOf(me.email);
      const arr = db.sheet[l.tab] || [];
      const i = row - 2;
      if (!arr[i] || sig(arr[i]) !== s) fail('הדיווח השתנה בינתיים. רעננו ונסו שוב.');
      arr.splice(i, 1);
      return true;
    },
    adminData: ({ month }) => {
      const byTab = {}; db.users.forEach((u) => { if (u.status === 'מאושר') byTab[u.tab] = u.email; });
      const has = db.months.some((m) => m.month === month);
      return {
        month, users: db.users, owners: db.owners, months: db.months,
        summary: has ? TABS.map((t) => { const rows = rowsOf(t, month); return { tab: t, email: byTab[t] || '', count: rows.length, hours: sum(rows) }; }) : null,
        tabs: TABS.map((t) => ({ tab: t, email: byTab[t] || '' })),
        settings: { emailNotifications: db.email },
      };
    },
    decideUser: ({ email, approve }) => {
      const u = db.users.find((x) => x.email === email);
      if (approve && !TABS.includes(u.tab)) TABS.push(u.tab);
      u.status = approve ? 'מאושר' : 'נדחה';
      return true;
    },
    removeUser: ({ email }) => { db.users = db.users.filter((u) => u.email !== email); return true; },
    addTab: ({ name }) => { if (TABS.includes(name)) fail('השם כבר קיים'); TABS.push(name); return { tab: name }; },
    deleteTab: ({ tab }) => { TABS = TABS.filter((t) => t !== tab); delete db.sheet[tab]; db.users = db.users.filter((u) => u.tab !== tab); return { deleted: 1 }; },
    normalizeTabs: () => ({ fixed: TABS.length, notes: [] }),
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
