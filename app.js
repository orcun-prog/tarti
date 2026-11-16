/* Tartı — arayüz. Veriler yalnızca bu cihazda, 6 haneli şifreden türetilen anahtarla (PBKDF2 + AES-GCM) şifreli saklanır. */
(function () {
  'use strict';
  const C = window.Core;
  const app = document.getElementById('app');
  const STORE = 'tarti.v1';
  const PREF = 'tarti.prefs';
  const VERSION = '1.0.0';
  const AUTOLOCK_MS = 2 * 60 * 1000;

  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(PREF) || '{}'); } catch (e) { prefs = {}; }
  const savePrefs = () => { try { localStorage.setItem(PREF, JSON.stringify(prefs)); } catch (e) { /* yok say */ } };

  // ---------- yardımcılar ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const today = () => C.todayStr();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let toastTimer = null;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const I = {
    home: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
    chart: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/></svg>',
    train: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/></svg>',
    list: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    user: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
    plus: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    share: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
    lock: '<svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
  };

  // ---------- şifreleme ----------
  const enc = new TextEncoder(), dec = new TextDecoder();
  function b64(buf) { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); }
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function deriveKey(pin, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  let KEY = null, SALT = null, DB = null;
  const hasStore = () => !!localStorage.getItem(STORE);
  async function save() {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, KEY, enc.encode(JSON.stringify(DB)));
    localStorage.setItem(STORE, JSON.stringify({ v: 1, salt: b64(SALT), iv: b64(iv), ct: b64(ct) }));
  }
  async function tryDecrypt(pin) {
    const raw = JSON.parse(localStorage.getItem(STORE));
    const salt = unb64(raw.salt);
    const key = await deriveKey(pin, salt);
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(raw.iv) }, key, unb64(raw.ct));
      return { key, salt, data: JSON.parse(dec.decode(pt)) };
    } catch (e) { return null; }
  }
  async function setPin(pin) { SALT = crypto.getRandomValues(new Uint8Array(16)); KEY = await deriveKey(pin, SALT); await save(); }
  const newDB = () => ({ v: 1, profile: null, weights: [], workouts: [], customExercises: [], hidden: [], dumbbellKg: null, lastBackup: null });
  const migrate = (d) => ({ ...newDB(), ...d });
  async function commit(msg) { try { await save(); if (msg) toast(msg); } catch (e) { toast('Kaydedilemedi: ' + e.message); } }

  // ---------- durum ----------
  const ui = { view: 'lock', pin: '', pinMode: 'unlock', pinFirst: null, pinErr: '', busy: false, fails: 0, lockedUntil: 0, form: {}, openId: null, hist: 'kilo', range: '3A', mode: 'kg', sheet: null, from: 'home', exportRange: '90', hiddenAt: 0 };
  const TABS = [['home', 'Özet', I.home], ['chart', 'Grafik', I.chart], ['train', 'Antrenman', I.train], ['history', 'Geçmiş', I.list], ['profile', 'Profil', I.user]];

  function go(view, extra) { Object.assign(ui, { view, openId: null, sheet: null }, extra || {}); render(); window.scrollTo(0, 0); }

  function render() {
    let html = '';
    const v = ui.view;
    if (v === 'lock') html = lockView();
    else if (v === 'onboard') html = profileFormView(true);
    else if (v === 'editProfile') html = profileFormView(false);
    else if (v === 'home') html = homeView();
    else if (v === 'addWeight') html = addWeightView();
    else if (v === 'chart') html = chartView();
    else if (v === 'train') html = trainView();
    else if (v === 'addWorkout') html = addWorkoutView();
    else if (v === 'history') html = historyView();
    else if (v === 'profile') html = profileView();
    if (TABS.some((t) => t[0] === v)) {
      html += `<div class="tabs"><nav aria-label="Ana menü">${TABS.map(([id, label, icon]) => `<button type="button" data-a="tab" data-v="${id}" ${id === v ? 'aria-current="page"' : ''}>${icon}${label}</button>`).join('')}</nav></div>`;
    }
    if (ui.sheet) html += sheetView();
    app.innerHTML = html;
  }

  // ---------- kilit ----------
  const PIN_TEXT = {
    unlock: ['Şifreni gir', '6 haneli şifre'],
    setup: ['Bir şifre belirle', '6 haneli. Verilerin bu şifreyle şifrelenir.'],
    confirm: ['Şifreyi tekrar gir', 'Doğrulamak için'],
    'change-old': ['Mevcut şifren', 'Şifre değiştirme'],
    'change-new': ['Yeni şifre', '6 haneli'],
    'change-confirm': ['Yeni şifreyi tekrar gir', 'Doğrulamak için']
  };
  function lockView() {
    const [title, sub] = PIN_TEXT[ui.pinMode];
    const dots = Array.from({ length: 6 }, (_, i) => `<i class="${i < ui.pin.length ? 'on' : ''}"></i>`).join('');
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => `<button type="button" data-a="key" data-k="${k}" aria-label="${k}">${k}</button>`).join('');
    const changing = ui.pinMode.startsWith('change');
    const waiting = ui.lockedUntil > Date.now();
    const install = !isStandalone() && isIOS() && ui.pinMode === 'setup'
      ? `<p class="small" style="text-align:center">İpucu: Safari'de <b>Paylaş</b> → <b>Ana Ekrana Ekle</b> ile uygulama gibi kullan. Şifreyi kurulumdan sonra, ana ekrandaki ikondan açınca belirle.</p>` : '';
    return `<section class="lock">
      <div class="logo">${I.lock}</div>
      <div class="stack" style="align-items:center;gap:6px"><h1>${title}</h1><span class="small">${sub}</span></div>
      <div class="dots ${ui.shake ? 'shake' : ''}" role="img" aria-label="${ui.pin.length} / 6 rakam girildi">${dots}</div>
      <p class="err" style="min-height:18px;text-align:center">${esc(waiting ? `Çok fazla deneme. ${Math.ceil((ui.lockedUntil - Date.now()) / 1000)} sn bekle.` : ui.busy ? 'Kontrol ediliyor…' : ui.pinErr)}</p>
      <div class="keypad">${keys}
        <button type="button" class="txt" data-a="${changing ? 'pin-cancel' : ui.pinMode === 'unlock' ? 'forgot' : 'noop'}">${changing ? 'Vazgeç' : ui.pinMode === 'unlock' ? 'Unuttum' : ''}</button>
        <button type="button" data-a="key" data-k="0" aria-label="0">0</button>
        <button type="button" class="txt" data-a="del" aria-label="Son rakamı sil">Sil</button>
      </div>
      ${install}
    </section>`;
  }
  async function onPinComplete() {
    const pin = ui.pin;
    ui.busy = true; render();
    try {
      if (ui.pinMode === 'unlock') {
        const r = await tryDecrypt(pin);
        if (r) {
          KEY = r.key; SALT = r.salt; DB = migrate(r.data); ui.fails = 0;
          resetPin(); ui.busy = false;
          if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
          return go(DB.profile ? 'home' : 'onboard');
        }
        ui.fails++;
        if (ui.fails >= 5) ui.lockedUntil = Date.now() + 30000 * (ui.fails - 4);
        return pinError('Şifre yanlış.');
      }
      if (ui.pinMode === 'setup' || ui.pinMode === 'change-new') {
        ui.pinFirst = pin; ui.pin = ''; ui.pinErr = ''; ui.busy = false;
        ui.pinMode = ui.pinMode === 'setup' ? 'confirm' : 'change-confirm';
        return render();
      }
      if (ui.pinMode === 'confirm' || ui.pinMode === 'change-confirm') {
        if (pin !== ui.pinFirst) { ui.pinMode = ui.pinMode === 'confirm' ? 'setup' : 'change-new'; return pinError('Şifreler eşleşmedi, baştan gir.'); }
        const isNew = ui.pinMode === 'confirm';
        if (isNew) DB = newDB();
        await setPin(pin);
        resetPin(); ui.busy = false;
        if (isNew) return go('onboard');
        toast('Şifre değişti'); return go('profile');
      }
      if (ui.pinMode === 'change-old') {
        const r = await tryDecrypt(pin);
        if (!r) return pinError('Mevcut şifre yanlış.');
        ui.pin = ''; ui.pinErr = ''; ui.busy = false; ui.pinMode = 'change-new'; return render();
      }
    } catch (e) { pinError('Bir hata oldu: ' + e.message); }
  }
  function pinError(msg) { ui.pin = ''; ui.pinErr = msg; ui.busy = false; ui.shake = true; render(); ui.shake = false; }
  function resetPin() { ui.pin = ''; ui.pinErr = ''; ui.pinFirst = null; }
  function lockNow() { KEY = null; DB = null; ui.form = {}; resetPin(); ui.pinMode = 'unlock'; go('lock'); }

  // ---------- profil formu ----------
  function profileFormView(isOnboard) {
    const p = (DB && DB.profile) || {};
    const f = ui.form;
    if (!f._init) Object.assign(f, { _init: true, sex: p.sex || 'e', age: p.age ?? '', height: p.height ?? '', weight: '', target: p.target != null ? C.fmt1(p.target) : '' });
    return `<section class="screen no-tabs">
      ${isOnboard ? `<div class="head"><div class="stack"><h1>Seni tanıyalım</h1><span class="sub">BMI'ını ve sağlıklı kilo aralığını hesaplamak için. Bu bilgiler yalnızca telefonunda, şifreli durur.</span></div></div>`
        : `<div class="bar"><button class="link l" data-a="nav" data-v="profile">Vazgeç</button><h1>Profili düzenle</h1><span></span></div>`}
      <div class="field"><span class="flabel" id="sexL">Cinsiyet</span>
        <div class="grid2" role="group" aria-labelledby="sexL">
          <button type="button" class="opt" data-a="set" data-k="sex" data-val="k" aria-pressed="${f.sex === 'k'}">Kadın</button>
          <button type="button" class="opt" data-a="set" data-k="sex" data-val="e" aria-pressed="${f.sex === 'e'}">Erkek</button>
        </div></div>
      <div class="grid2">
        <div class="field"><label for="age">Yaş</label><input class="input" id="age" data-f="age" inputmode="numeric" value="${esc(f.age)}" autocomplete="off"></div>
        <div class="field"><label for="height">Boy (cm)</label><input class="input" id="height" data-f="height" inputmode="numeric" value="${esc(f.height)}" autocomplete="off"></div>
      </div>
      ${isOnboard ? `<div class="field"><label for="weight">Şu anki kilo (kg)</label><input class="input" id="weight" data-f="weight" inputmode="decimal" value="${esc(f.weight)}" autocomplete="off"></div>` : ''}
      <div class="field"><label for="target">Hedef kilo (kg)</label><input class="input" id="target" data-f="target" inputmode="decimal" value="${esc(f.target)}" autocomplete="off">
        <span class="hint" id="rangeHint">${rangeHint(f.height)}</span></div>
      <p class="tiny">18 yaş altı için BMI yaşa ve cinsiyete göre yorumlanır; buradaki kategoriler yetişkinler içindir. Uygulama tıbbi tavsiye yerine geçmez.</p>
      <p class="err" id="formErr">${esc(f._err || '')}</p>
      <button class="btn" data-a="save-profile" data-onboard="${isOnboard ? 1 : ''}">${isOnboard ? 'Başla' : 'Kaydet'}</button>
      ${isOnboard ? `<button class="link" data-a="import">Yedekten geri yükle (CSV)</button>` : ''}
    </section>`;
  }
  function rangeHint(h) {
    const cm = C.parseNum(h);
    if (!(cm >= 120 && cm <= 230)) return 'Boyunu girince sağlıklı kilo aralığını gösteririm.';
    const [a, b] = C.normalRange(cm);
    return `${Math.round(cm)} cm için normal BMI aralığı: ${C.fmt1(a)} – ${C.fmt1(b)} kg`;
  }
  async function saveProfile(isOnboard) {
    const f = ui.form;
    const age = parseInt(f.age, 10), height = C.parseNum(f.height), target = C.parseNum(f.target), weight = C.parseNum(f.weight);
    let err = '';
    if (!(age >= 10 && age <= 100)) err = 'Yaşı kontrol et (10–100).';
    else if (!(height >= 120 && height <= 230)) err = 'Boyu santimetre olarak gir (120–230).';
    else if (isOnboard && !(weight >= 30 && weight <= 300)) err = 'Şu anki kiloyu gir (30–300 kg).';
    else if (!(target >= 30 && target <= 300)) err = 'Hedef kiloyu gir (30–300 kg).';
    if (err) { f._err = err; return render(); }
    const prev = DB.profile || {};
    DB.profile = { ...prev, sex: f.sex, age, height, target, startWeight: prev.startWeight || (isOnboard ? weight : (C.latestWeight(DB) || {}).kg) || null, createdAt: prev.createdAt || today() };
    if (isOnboard) DB.weights.push({ id: uid(), date: today(), kg: Math.round(weight * 10) / 10, note: '', ts: Date.now() });
    await commit(isOnboard ? 'Hoş geldin!' : 'Profil güncellendi');
    ui.form = {};
    go(isOnboard ? 'home' : 'profile');
  }

  // ---------- ortak kartlar ----------
  function bmiGauge(b, targetB) {
    const pos = (x) => clamp(((x - 15) / 20) * 100, 1, 99);
    const cat = C.bmiCat(b);
    return `<div class="between"><div class="row" style="gap:8px;align-items:baseline"><span class="label">BMI</span><span style="font-size:24px;font-weight:700">${C.fmt1(b)}</span></div>
        <span class="pill" style="background:${cat.bg};color:${cat.fg}">${cat.label}</span></div>
      <div class="gauge" role="img" aria-label="BMI ${C.fmt1(b)}, ${cat.label}${targetB ? '; hedefin BMI ' + C.fmt1(targetB) : ''}">
        <div class="bar5"><div style="width:17.5%;background:#93C5FD"></div><div style="width:32.5%;background:#22C55E"></div><div style="width:25%;background:#FBBF24"></div><div style="width:25%;background:#B91C1C"></div></div>
        ${targetB ? `<div class="mark" style="left:${pos(targetB)}%"><span style="color:var(--accent)">Hedef</span><i style="background:var(--accent)"></i></div>` : ''}
        <div class="mark" style="left:${pos(b)}%"><span>Sen</span><i style="background:var(--ink)"></i></div>
        <div class="labels"><span style="width:17.5%">Zayıf<br>&lt;18,5</span><span style="width:32.5%">Normal<br>18,5–24,9</span><span style="width:25%">Fazla kilolu<br>25–29,9</span><span style="width:25%">Obez<br>≥30</span></div>
      </div>`;
  }

  function todayCard() {
    const r = C.recommend(DB);
    const plan = r.plan;
    const doneToday = DB.workouts.filter((w) => w.date === today());
    let body = '';
    if (plan) {
      const pill = r.group && r.group !== 'cardio' ? `<span class="pill" style="background:#DCFCE7;color:#166534">${esc(C.GROUPS[r.group].name)} · hazır</span>` : r.group === 'cardio' ? `<span class="pill" style="background:var(--line);color:var(--ink2)">Kardiyo</span>` : '';
      const lastTxt = plan.last ? ` · geçen sefer ${C.fmtWorkout(DB, plan.last)} (${C.FEEL[plan.last.feel].toLocaleLowerCase('tr')})` : '';
      const planText = C.fmtWorkout(DB, { ex: plan.ex.id, sets: plan.sets, amount: plan.amount, kg: plan.kg });
      body = `<div class="between"><span class="label" style="font-weight:600">${r.kind.startsWith('done') ? 'Bugün' : 'Bugünün antrenmanı'}</span>${pill}</div>
        ${r.kind.startsWith('done') ? `<p class="small">${esc(r.reason)}</p>` : ''}
        <div class="stack"><span style="font-size:24px;font-weight:700;line-height:1.2">${esc(planText.charAt(0).toLocaleUpperCase('tr') + planText.slice(1))}</span>
          <span class="small">${r.kind.startsWith('done') ? '' : esc(r.reason) + esc(lastTxt)}</span>
          ${plan.note ? `<span class="small" style="color:var(--accent)">${esc(plan.note)}</span>` : ''}
          ${plan.ex.tip ? `<span class="tiny">${esc(plan.ex.tip)}</span>` : ''}</div>
        <div class="grid2"><button class="btn mid" data-a="did-plan">Yaptım</button><button class="btn mid sec" data-a="new-workout">Başka bir şey yaptım</button></div>`;
    } else {
      body = `<div class="between"><span class="label" style="font-weight:600">Bugün</span><span class="pill" style="background:var(--line);color:var(--ink2)">${r.kind === 'done' ? 'Tamam' : 'Dinlenme'}</span></div>
        <p style="font-size:17px;font-weight:600">${esc(r.reason)}</p>
        <button class="btn mid sec" data-a="new-workout">Yine de bir şey yaptım</button>`;
    }
    if (doneToday.length) body += `<p class="tiny">Bugün yapılanlar: ${doneToday.map((w) => esc(C.fmtWorkout(DB, w))).join(' · ')}</p>`;
    return `<section class="card" aria-label="Bugünün önerisi">${body}</section>`;
  }

  function banners() {
    let out = '';
    const n = DB.weights.length + DB.workouts.length;
    const days = DB.lastBackup ? C.daysBetween(DB.lastBackup.slice(0, 10), today()) : null;
    if (n >= 5 && (days === null || days >= 30) && prefs.backupSnooze !== today()) {
      out += `<div class="banner"><span style="flex:1">${days === null ? 'Henüz yedek almadın.' : `Son yedek ${days} gün önce.`} Telefon değişirse diye ayda bir dışa aktar.</span><button class="link" data-a="open-export">Yedekle</button><button class="link" data-a="snooze-backup" aria-label="Bugün gösterme">✕</button></div>`;
    }
    if (!isStandalone() && isIOS() && !prefs.installDismissed) {
      out += `<div class="banner"><span style="flex:1">Ana ekrana ekle: Safari'de <b>Paylaş</b> → <b>Ana Ekrana Ekle</b>.</span><button class="link" data-a="dismiss-install" aria-label="Kapat">✕</button></div>`;
    }
    return out;
  }

  // ---------- Özet ----------
  function homeView() {
    const p = DB.profile;
    const lw = C.latestWeight(DB);
    let cards = '';
    if (!lw) {
      cards += `<section class="card"><h2>Henüz kilo kaydı yok</h2><p class="small">İlk kaydını gir, gerisini ben hesaplarım.</p><button class="btn" data-a="new-weight">${I.plus} Kilo ekle</button></section>`;
    } else {
      const start = C.sortedWeights(DB)[0].kg;
      const diff = lw.kg - start;
      const rate = C.recentRate(DB, 28);
      cards += `<section class="card"><div class="between" style="align-items:flex-end">
          <div class="stack"><span class="label">Güncel kilo</span><span class="big">${C.fmt1(lw.kg)} <small>kg</small></span>
          <span class="small">Son kayıt: ${C.fmtDate(lw.date)} · Başlangıçtan ${diff <= 0 ? '−' : '+'}${C.fmt1(Math.abs(diff))} kg${rate != null ? ` · Son 4 hafta: ${rate <= 0 ? '↓' : '↑'} ${C.fmt1(Math.abs(rate))} kg/hafta` : ''}</span></div>
          <button class="btn pillbtn" data-a="new-weight" style="flex:none">${I.plus} Kilo</button></div></section>`;
      const b = C.bmi(lw.kg, p.height);
      cards += `<section class="card">${bmiGauge(b, C.bmi(p.target, p.height))}${p.age < 18 ? '<p class="warn">18 yaş altında BMI yaşa ve cinsiyete göre persentille değerlendirilir; bu kategoriler yetişkinler içindir.</p>' : ''}</section>`;
      const total = start - p.target, done = start - lw.kg;
      const pct = total === 0 ? 100 : clamp(Math.round((done / total) * 100), 0, 100);
      const left = lw.kg - p.target;
      const [lo, hi] = C.normalRange(p.height);
      let rangeTxt;
      if (lw.kg > hi) rangeTxt = `Normal aralığa girmene ${C.fmt1(lw.kg - hi)} kg kaldı.`;
      else if (lw.kg < lo) rangeTxt = `Normal aralığın ${C.fmt1(lo - lw.kg)} kg altındasın.`;
      else rangeTxt = 'Normal BMI aralığındasın.';
      let eta = '';
      if (rate != null && Math.abs(left) > 0.05 && Math.sign(rate) === -Math.sign(left) && Math.abs(rate) > 0.02) {
        const w = Math.abs(left / rate);
        if (w < 260) eta = ` · Bu hızla ~${Math.ceil(w)} hafta`;
      }
      cards += `<section class="card"><div class="between" style="align-items:baseline"><h2>Hedef: ${C.fmt1(p.target)} kg</h2><span class="label">%${pct} tamam</span></div>
        <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Hedef ilerlemesi"><div style="width:${pct}%"></div></div>
        <div class="between small"><span>Başlangıç ${C.fmt1(start)}</span><span>${Math.abs(left) < 0.05 ? 'Hedefe ulaştın!' : `${C.fmt1(Math.abs(left))} kg kaldı${eta}`}</span></div>
        <p class="note">Boyuna göre normal BMI aralığı: ${C.fmt1(lo)} – ${C.fmt1(hi)} kg. ${rangeTxt}</p></section>`;
    }
    cards += todayCard();
    return `<section class="screen">
      <div class="head"><div class="stack"><span class="sub">${C.fmtLongToday()}</span><h1>Özet</h1></div></div>
      ${banners()}${cards}</section>`;
  }

  // ---------- Kilo ekle / düzenle ----------
  function addWeightView() {
    const f = ui.form;
    const kg = C.parseNum(f.kg);
    const p = DB.profile;
    const t = today(), y = C.addDays(t, -1);
    return `<section class="screen no-tabs">
      <div class="bar"><button class="link l" data-a="back">Vazgeç</button><h1>${f.editId ? 'Kaydı düzenle' : 'Kilo kaydı ekle'}</h1>${f.editId ? '<button class="link danger r" data-a="del-weight">Sil</button>' : '<span></span>'}</div>
      <div class="stack" style="align-items:center;gap:8px;padding:8px 0">
        <label for="kg" class="label">Kilo (kg)</label>
        <div class="row" style="gap:16px">
          <button type="button" class="round" data-a="kg-step" data-d="-0.1" aria-label="0,1 kg azalt">−</button>
          <input id="kg" class="kg-input" data-f="kg" data-live="bmi" inputmode="decimal" value="${esc(f.kg)}" autocomplete="off">
          <button type="button" class="round" data-a="kg-step" data-d="0.1" aria-label="0,1 kg artır">+</button>
        </div>
        <span class="small" id="bmiPreview">${bmiPreview(kg, p)}</span>
      </div>
      <div class="field"><span class="flabel">Tarih</span>
        <div class="chips">
          <button type="button" class="chip" data-a="set-date" data-val="${t}" aria-pressed="${f.date === t}">Bugün</button>
          <button type="button" class="chip" data-a="set-date" data-val="${y}" aria-pressed="${f.date === y}">Dün</button>
        </div>
        <label for="wdate" class="sr">Tarih seç</label>
        <input id="wdate" type="date" class="input" data-f="date" data-live="rerender" max="${t}" value="${esc(f.date)}">
        <span class="hint">Geçmiş bir tarihe de kayıt girebilirsin.</span></div>
      <div class="field"><label for="wnote">Not (isteğe bağlı)</label><input id="wnote" class="input" data-f="note" value="${esc(f.note)}" placeholder="Ör. sabah, aç karnına" autocomplete="off"></div>
      <p class="err">${esc(f._err || '')}</p>
      <button class="btn" data-a="save-weight">Kaydet</button>
    </section>`;
  }
  function bmiPreview(kg, p) {
    if (!(kg >= 30 && kg <= 300) || !p) return '&nbsp;';
    const b = C.bmi(kg, p.height); return `Bu kayıtla BMI: <b style="color:var(--ink)">${C.fmt1(b)}</b> · ${C.bmiCat(b).label}`;
  }
  function openWeight(rec) {
    const lw = C.latestWeight(DB);
    ui.form = rec ? { editId: rec.id, kg: C.fmt1(rec.kg), date: rec.date, note: rec.note || '' } : { kg: lw ? C.fmt1(lw.kg) : '', date: today(), note: '' };
    ui.from = ui.view; go('addWeight');
  }
  async function saveWeight() {
    const f = ui.form;
    const kg = C.parseNum(f.kg);
    if (!(kg >= 30 && kg <= 300)) { f._err = 'Kiloyu kontrol et (30–300 kg).'; return render(); }
    if (!C.isDate(f.date) || f.date > today()) { f._err = 'Geçerli bir tarih seç (bugün veya öncesi).'; return render(); }
    const rec = { kg: Math.round(kg * 10) / 10, date: f.date, note: (f.note || '').trim() };
    if (f.editId) {
      const i = DB.weights.findIndex((w) => w.id === f.editId);
      if (i >= 0) DB.weights[i] = { ...DB.weights[i], ...rec };
    } else {
      const same = DB.weights.find((w) => w.date === f.date);
      if (same && confirm(`${C.fmtDate(f.date)} için zaten ${C.fmt1(same.kg)} kg kaydı var. Onu güncelleyeyim mi?\n\n(İptal dersen ikinci bir kayıt olarak eklenir.)`)) Object.assign(same, rec, { ts: Date.now() });
      else DB.weights.push({ id: uid(), ...rec, ts: Date.now() });
    }
    await commit('Kaydedildi');
    ui.form = {}; go(ui.from === 'history' ? 'history' : 'home');
  }

  // ---------- Grafik ----------
  const RANGES = [['1H', 7], ['1A', 30], ['3A', 90], ['1Y', 365], ['Tümü', null]];
  function chartView() {
    const p = DB.profile;
    const all = C.sortedWeights(DB);
    const t = today();
    const days = RANGES.find((r) => r[0] === ui.range)[1];
    const from = days ? C.addDays(t, -days) : all.length ? all[0].date : t;
    const pts = all.filter((w) => w.date >= from && w.date <= t);
    const isB = ui.mode === 'bmi';
    const val = (kg) => (isB ? C.bmi(kg, p.height) : kg);
    const f1 = (n) => C.fmt1(n) + (isB ? '' : ' kg');
    let stats = '';
    if (pts.length) {
      const first = pts[0], last = pts[pts.length - 1];
      const rate = C.weeklyRate(pts);
      const left = last.kg - p.target;
      let eta = '—';
      if (rate != null && Math.sign(rate) === -Math.sign(left) && Math.abs(rate) > 0.02 && Math.abs(left) > 0.05) { const w = Math.abs(left / rate); if (w < 260) eta = `~${Math.ceil(w)} hafta`; }
      if (Math.abs(left) <= 0.05) eta = 'Ulaştın';
      const ch = val(last.kg) - val(first.kg);
      const stat = (l, v) => `<div class="card" style="padding:12px 14px;gap:2px"><span class="small">${l}</span><span style="font-size:20px;font-weight:700">${v}</span></div>`;
      stats = `<div class="grid2">${stat('Aralık başı', f1(val(first.kg)))}${stat('Şu an', f1(val(last.kg)))}${stat('Değişim', (ch <= 0 ? '−' : '+') + f1(Math.abs(ch)))}${stat('Haftalık eğilim', rate == null ? '—' : (rate <= 0 ? '−' : '+') + C.fmt1(Math.abs(rate)) + ' kg')}</div>
        <div class="card" style="padding:12px 14px;gap:2px"><span class="small">Bu eğilimle hedefe (${C.fmt1(p.target)} kg)</span><span style="font-size:20px;font-weight:700">${eta}</span></div>`;
    }
    return `<section class="screen">
      <div class="head"><h1>Grafik</h1>
        <div class="seg" role="group" aria-label="Gösterim" style="width:120px">
          <button type="button" data-a="mode" data-val="kg" aria-pressed="${!isB}">kg</button><button type="button" data-a="mode" data-val="bmi" aria-pressed="${isB}">BMI</button></div></div>
      <div class="seg" role="group" aria-label="Zaman aralığı">${RANGES.map(([k]) => `<button type="button" data-a="range" data-val="${k}" aria-pressed="${ui.range === k}">${k}</button>`).join('')}</div>
      <section class="card chart" style="padding:14px 10px 10px">
        ${pts.length ? `<div class="between" style="padding:0 6px"><span class="small">${C.fmtDate(from)} – ${C.fmtDate(t)}</span><span style="font-weight:700">${pts.length} kayıt</span></div>${chartSvg(pts, from, t, isB, p)}
        <div class="legend" style="padding:0 6px"><span><i style="width:14px;height:3px;background:var(--accent);display:block"></i>${isB ? 'BMI' : 'Kilo'}</span><span><i style="width:14px;border-top:2px dashed var(--ink);display:block"></i>Hedef</span><span><i style="width:12px;height:10px;background:#DCFCE7;display:block"></i>Normal BMI</span><span><i style="width:3px;height:8px;background:var(--accent);opacity:.45;display:block"></i>Antrenman günü</span></div>`
        : `<p class="empty">Bu aralıkta kilo kaydı yok.</p>`}
      </section>${stats}</section>`;
  }
  function chartSvg(pts, from, to, isB, p) {
    const W = 350, H = 230, L = 36, R = 10, T = 10, B = 26;
    const pw = W - L - R, ph = H - T - B;
    const val = (kg) => (isB ? C.bmi(kg, p.height) : kg);
    const vs = pts.map((x) => val(x.kg));
    const tgt = val(p.target);
    const [nlo, nhi] = isB ? [18.5, 24.9] : C.normalRange(p.height);
    let lo = Math.min(...vs, tgt), hi = Math.max(...vs, tgt);
    const padv = Math.max(isB ? 0.3 : 1, (hi - lo) * 0.08); lo -= padv; hi += padv;
    const steps = isB ? [0.5, 1, 2, 5] : [0.5, 1, 2, 5, 10, 20];
    const step = steps.find((s) => (hi - lo) / s <= 5) || steps[steps.length - 1];
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const span = Math.max(1, C.daysBetween(from, to));
    const X = (d) => L + (C.daysBetween(from, d) / span) * pw;
    const Y = (v) => T + ((hi - v) / (hi - lo)) * ph;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${isB ? 'BMI' : 'Kilo'} grafiği: ${C.fmt1(vs[0])}'dan ${C.fmt1(vs[vs.length - 1])}'a; hedef ${C.fmt1(tgt)}">`;
    const bTop = clamp(Y(nhi), T, T + ph), bBot = clamp(Y(nlo), T, T + ph);
    if (bBot > bTop) s += `<rect x="${L}" y="${bTop}" width="${pw}" height="${bBot - bTop}" fill="#DCFCE7"/>`;
    for (let v = lo; v <= hi + 1e-9; v += step) {
      const y = Y(v);
      s += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="#E7E5E4"/><text x="${L - 6}" y="${y + 3.5}" text-anchor="end" font-size="10" fill="#57534E">${C.fmtNum(Math.round(v * 10) / 10)}</text>`;
    }
    const wDays = [...new Set(DB.workouts.filter((w) => w.date >= from && w.date <= to).map((w) => w.date))];
    for (const d of wDays) s += `<rect x="${X(d) - 1.5}" y="${T + ph - 8}" width="3" height="8" fill="#0F766E" opacity=".45"/>`;
    s += `<line x1="${L}" y1="${Y(tgt)}" x2="${W - R}" y2="${Y(tgt)}" stroke="#171717" stroke-width="1.5" stroke-dasharray="5 4"/>`;
    const ty = Y(tgt) < T + 14 ? Y(tgt) + 12 : Y(tgt) - 5;
    s += `<text x="${L + 4}" y="${ty}" font-size="9" font-weight="600" fill="#171717">Hedef ${C.fmt1(tgt)}</text>`;
    const poly = pts.map((x, i) => `${X(x.date).toFixed(1)},${Y(vs[i]).toFixed(1)}`).join(' ');
    if (pts.length > 1) s += `<polyline fill="none" stroke="#0F766E" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${poly}"/>`;
    if (pts.length <= 60) pts.forEach((x, i) => { s += `<circle cx="${X(x.date).toFixed(1)}" cy="${Y(vs[i]).toFixed(1)}" r="3" fill="#fff" stroke="#0F766E" stroke-width="1.5"/>`; });
    const lp = pts[pts.length - 1];
    s += `<circle cx="${X(lp.date).toFixed(1)}" cy="${Y(vs[vs.length - 1]).toFixed(1)}" r="5" fill="#0F766E"/>`;
    const lab = [from, C.addDays(from, Math.round(span / 2)), to];
    lab.forEach((d, i) => { s += `<text x="${i === 0 ? L : i === 2 ? W - R : X(d)}" y="${H - 8}" font-size="10" fill="#57534E" text-anchor="${i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}">${C.fmtDate(d)}</text>`; });
    return s + '</svg>';
  }

  // ---------- Antrenman ----------
  function trainView() {
    const st = C.groupStatus(DB);
    const rec = C.recommend(DB);
    const groups = st.map((g) => {
      const name = C.GROUPS[g.g].long;
      const last = g.last ? `${C.fmtDate(g.last.date)} · ${C.fmtWorkout(DB, g.last)}` : 'Henüz kayıt yok';
      let pill;
      if (g.g === 'cardio') pill = '<span class="pill" style="background:var(--line);color:var(--ink2)">Her gün</span>';
      else if (g.ready) pill = `<span class="pill" style="background:#DCFCE7;color:#166534">Hazır${rec.group === g.g && rec.kind === 'strength' ? ' · sırada' : ''}</span>`;
      else pill = `<span class="pill" style="background:#FEF3C7;color:#92400E">${g.readyIn === 1 ? 'Yarın hazır' : g.readyIn + ' gün sonra'}</span>`;
      return `<li><div class="item"><div class="main"><span class="t">${esc(name)}</span><span class="s">${esc(last)}</span></div>${pill}</div></li>`;
    }).join('');
    const logs = C.sortRecs(DB.workouts).reverse().slice(0, 15);
    return `<section class="screen">
      <div class="head"><h1>Antrenman</h1><button class="btn pillbtn" data-a="new-workout">${I.plus} Kaydet</button></div>
      ${todayCard()}
      <h2 class="sec-title">Kas grupları</h2>
      <section class="card tight"><ul class="list">${groups}</ul></section>
      <p class="tiny" style="padding:0 4px">Kuvvet çalışan grup ~48 saat dinlenir. Yürüyüş hiçbir grubu bloke etmez.</p>
      <h2 class="sec-title">Son kayıtlar</h2>
      <section class="card tight">${logs.length ? `<ul class="list">${logs.map(workoutItem).join('')}</ul>` : '<p class="empty">Henüz antrenman kaydı yok.</p>'}</section>
    </section>`;
  }
  function workoutItem(w) {
    const ex = C.exById(DB, w.ex);
    const open = ui.openId === w.id;
    return `<li><button type="button" class="item" data-a="toggle" data-id="${w.id}" aria-expanded="${open}">
        <span style="width:58px;font-size:12px;font-weight:600;color:var(--ink2)">${C.fmtDate(w.date)}</span>
        <span class="main"><span class="t">${esc(C.fmtWorkout(DB, w))}</span><span class="s">${esc(ex ? C.GROUPS[ex.g].name : '')}${w.note ? ' · ' + esc(w.note) : ''}</span></span>
        <span class="s">${C.FEEL[w.feel] || ''}</span></button>
      ${open ? `<div class="item-actions"><button class="btn sec" data-a="edit-workout" data-id="${w.id}">Düzenle</button><button class="btn danger" data-a="del-workout" data-id="${w.id}">Sil</button></div>` : ''}</li>`;
  }

  function openWorkout(opts) {
    const o = opts || {};
    let f;
    if (o.rec) {
      const w = o.rec;
      f = { editId: w.id, ex: w.ex, sets: w.sets, amount: w.amount, kg: w.kg ? C.fmtNum(w.kg) : '', feel: w.feel || 'tam', date: w.date, note: w.note || '' };
    } else if (o.plan) {
      const pl = o.plan;
      f = { ex: pl.ex.id, sets: pl.sets, amount: pl.amount, kg: pl.kg ? C.fmtNum(pl.kg) : (DB.dumbbellKg ? C.fmtNum(DB.dumbbellKg) : ''), feel: 'tam', date: today(), note: '' };
    } else f = { ex: null, sets: 2, amount: 10, kg: '', feel: 'tam', date: today(), note: '' };
    ui.form = f; ui.from = ui.view; go('addWorkout');
  }
  function pickExercise(id) {
    const ex = C.exById(DB, id);
    const f = ui.form;
    f.ex = id;
    if (!f.editId) {
      const pl = C.progress(DB, ex);
      f.sets = pl.ex.id === ex.id ? pl.sets : (ex.single ? 1 : 2);
      f.amount = pl.ex.id === ex.id ? pl.amount : ex.start;
      f.kg = ex.w ? C.fmtNum((pl.ex.id === ex.id && pl.kg) || DB.dumbbellKg || '') : '';
      if (f.kg === 'NaN' || f.kg === '0') f.kg = '';
    }
  }
  function addWorkoutView() {
    const f = ui.form;
    const t = today(), y = C.addDays(t, -1);
    const exs = C.allExercises(DB).filter((e) => !C.isHidden(DB, e.id) || e.id === f.ex);
    const sel = f.ex ? C.exById(DB, f.ex) : null;
    const showList = f.showList || !sel;
    const listHtml = C.GROUP_ORDER.map((g) => {
      const items = exs.filter((e) => e.g === g).sort((a, b) => (a.lvl || 9) - (b.lvl || 9));
      if (!items.length) return '';
      return `<div class="group-h">${esc(C.GROUPS[g].long)}</div>` + items.map((e) => {
        const on = e.id === f.ex;
        return `<button type="button" class="item" role="radio" aria-checked="${on}" data-a="pick-ex" data-id="${e.id}" style="min-height:48px;border-bottom:1px solid var(--line2)">
          <span class="main"><span class="t" style="font-weight:${on ? 700 : 500}">${esc(e.name)}</span>${on && e.tip ? `<span class="s">${esc(e.tip)}</span>` : ''}</span><span class="radio-dot"></span></button>`;
      }).join('');
    }).join('');
    const amtLabel = !sel ? 'Tekrar' : sel.unit === 'reps' ? 'Tekrar' : sel.unit === 'sec' ? 'Süre' : 'Süre';
    return `<section class="screen no-tabs">
      <div class="bar"><button class="link l" data-a="back">Vazgeç</button><h1>${f.editId ? 'Antrenmanı düzenle' : 'Antrenman kaydı'}</h1>${f.editId ? '<button class="link danger r" data-a="del-workout" data-id="' + f.editId + '">Sil</button>' : '<span></span>'}</div>
      <div class="field"><span class="flabel">Tarih</span>
        <div class="chips"><button type="button" class="chip" data-a="set-date" data-val="${t}" aria-pressed="${f.date === t}">Bugün</button><button type="button" class="chip" data-a="set-date" data-val="${y}" aria-pressed="${f.date === y}">Dün</button></div>
        <label for="adate" class="sr">Tarih seç</label><input id="adate" type="date" class="input" data-f="date" data-live="rerender" max="${t}" value="${esc(f.date)}"></div>
      <div class="field"><span class="flabel" id="exL">Hareket</span>
        ${showList ? `<section class="card tight" role="radiogroup" aria-labelledby="exL">${listHtml}
          <button type="button" class="item" data-a="open-custom" style="min-height:48px;color:var(--accent);font-weight:600">${I.plus} Yeni hareket ekle</button></section>`
        : `<section class="card" style="padding:12px 14px;gap:4px" aria-labelledby="exL"><div class="between"><div class="stack"><span style="font-size:17px;font-weight:700">${esc(sel.name)}</span><span class="small">${esc(C.GROUPS[sel.g].long)}</span></div><button type="button" class="link" data-a="show-list">Değiştir</button></div>${sel.tip ? `<span class="tiny">${esc(sel.tip)}</span>` : ''}</section>`}
        ${sel && !f.editId ? `<button type="button" class="link" style="align-self:flex-start;font-size:13px" data-a="hide-ex" data-id="${sel.id}">Bu hareket ağrı yapıyor, önerme</button>` : ''}</div>
      ${sel ? `<div class="grid2">
        <div class="card" style="padding:10px 12px;gap:6px"><span class="small">Set</span><div class="stepper">
          <button type="button" class="round" data-a="sets" data-d="-1" aria-label="Set azalt">−</button><span class="step-val">${f.sets}</span><button type="button" class="round" data-a="sets" data-d="1" aria-label="Set artır">+</button></div></div>
        <div class="card" style="padding:10px 12px;gap:6px"><span class="small">${amtLabel}</span><div class="stepper">
          <button type="button" class="round" data-a="amt" data-d="-1" aria-label="Azalt">−</button><span class="step-val" style="font-size:${sel.unit === 'reps' ? 22 : 17}px">${esc(C.fmtAmount(sel, f.amount))}</span><button type="button" class="round" data-a="amt" data-d="1" aria-label="Artır">+</button></div></div>
      </div>
      ${sel.w ? `<div class="field"><label for="dkg">Dambıl ağırlığı (kg, tek dambıl)</label><input id="dkg" class="input" data-f="kg" inputmode="decimal" value="${esc(f.kg)}" placeholder="Ör. 8" autocomplete="off"></div>` : ''}
      <div class="field"><span class="flabel" id="feelL">Nasıldı?</span><div class="grid3" role="group" aria-labelledby="feelL">
        ${['kolay', 'tam', 'zor'].map((k) => `<button type="button" class="opt" style="font-size:14px" data-a="set" data-k="feel" data-val="${k}" aria-pressed="${f.feel === k}">${C.FEEL[k]}</button>`).join('')}</div>
        <span class="hint">“Zordu” dersen bir dahaki sefere artırmam.</span></div>
      <div class="field"><label for="anote">Not (isteğe bağlı)</label><input id="anote" class="input" data-f="note" value="${esc(f.note)}" autocomplete="off"></div>` : ''}
      <p class="err">${esc(f._err || '')}</p>
      <button class="btn" data-a="save-workout" ${sel ? '' : 'disabled'}>${sel ? 'Kaydet · ' + esc(C.fmtWorkout(DB, { ex: sel.id, sets: f.sets, amount: f.amount, kg: C.parseNum(f.kg) })) : 'Bir hareket seç'}</button>
    </section>`;
  }
  async function saveWorkout() {
    const f = ui.form;
    const ex = C.exById(DB, f.ex);
    if (!ex) { f._err = 'Bir hareket seç.'; return render(); }
    if (!C.isDate(f.date) || f.date > today()) { f._err = 'Geçerli bir tarih seç (bugün veya öncesi).'; return render(); }
    const kg = ex.w ? C.parseNum(f.kg) : null;
    if (ex.w && f.kg !== '' && !(kg > 0 && kg < 100)) { f._err = 'Dambıl ağırlığını kontrol et.'; return render(); }
    const rec = { date: f.date, ex: ex.id, sets: f.sets, amount: f.amount, kg: ex.w && kg > 0 ? kg : null, feel: f.feel, note: (f.note || '').trim() };
    if (ex.w && kg > 0) DB.dumbbellKg = kg;
    if (f.editId) { const i = DB.workouts.findIndex((w) => w.id === f.editId); if (i >= 0) DB.workouts[i] = { ...DB.workouts[i], ...rec }; }
    else DB.workouts.push({ id: uid(), ...rec, ts: Date.now() });
    await commit('Antrenman kaydedildi');
    ui.form = {}; go(['home', 'train', 'history'].includes(ui.from) ? ui.from : 'train');
  }

  // ---------- Geçmiş ----------
  function historyView() {
    const isW = ui.hist === 'kilo';
    let body;
    if (isW) {
      const ws = C.sortRecs(DB.weights).reverse();
      body = ws.length ? `<ul class="list">${ws.map((w, i) => {
        const prev = ws[i + 1];
        const d = prev ? w.kg - prev.kg : null;
        const open = ui.openId === w.id;
        return `<li><button type="button" class="item" data-a="toggle" data-id="${w.id}" aria-expanded="${open}">
            <span class="main"><span class="t">${C.fmtDate(w.date, true)}</span><span class="s">BMI ${C.fmt1(C.bmi(w.kg, DB.profile.height))}${w.note ? ' · ' + esc(w.note) : ''}</span></span>
            <span class="pill" style="background:var(--bg);color:var(--ink2)">${d == null ? '—' : (d > 0 ? '+' : d < 0 ? '−' : '±') + C.fmt1(Math.abs(d))}</span>
            <span class="v" style="min-width:72px;text-align:right">${C.fmt1(w.kg)} kg</span></button>
          ${open ? `<div class="item-actions"><button class="btn sec" data-a="edit-weight" data-id="${w.id}">Düzenle</button><button class="btn danger" data-a="del-weight" data-id="${w.id}">Sil</button></div>` : ''}</li>`;
      }).join('')}</ul>` : '<p class="empty">Henüz kilo kaydı yok.</p>';
    } else {
      const ws = C.sortRecs(DB.workouts).reverse();
      body = ws.length ? `<ul class="list">${ws.map(workoutItem).join('')}</ul>` : '<p class="empty">Henüz antrenman kaydı yok.</p>';
    }
    return `<section class="screen">
      <div class="head"><h1>Geçmiş</h1><div class="row" style="gap:8px">
        <button class="btn pillbtn sec" style="padding:0 12px" data-a="import">İçe aktar</button>
        <button class="btn pillbtn" style="padding:0 12px" data-a="open-export">${I.share} Dışa aktar</button></div></div>
      <div class="seg" role="group" aria-label="Kayıt türü"><button type="button" data-a="hist" data-val="kilo" aria-pressed="${isW}">Kilo (${DB.weights.length})</button><button type="button" data-a="hist" data-val="antrenman" aria-pressed="${!isW}">Antrenman (${DB.workouts.length})</button></div>
      <p class="tiny" style="padding:0 4px">Bir kayda dokun: düzenle veya sil.</p>
      <section class="card tight">${body}</section>
    </section>`;
  }

  // ---------- Profil ----------
  function profileView() {
    const p = DB.profile;
    const hidden = (DB.hidden || []).map((id) => C.exById(DB, id)).filter(Boolean);
    const days = DB.lastBackup ? C.daysBetween(DB.lastBackup.slice(0, 10), today()) : null;
    const customs = DB.customExercises || [];
    return `<section class="screen">
      <div class="head"><h1>Profil</h1></div>
      <section class="card"><div class="between"><h2>Bilgilerin</h2><button class="link" data-a="edit-profile">Düzenle</button></div>
        <div class="grid2 small" style="color:var(--ink)">
          <span><span class="small">Cinsiyet</span><br><b>${p.sex === 'k' ? 'Kadın' : 'Erkek'}</b></span><span><span class="small">Yaş</span><br><b>${p.age}</b></span>
          <span><span class="small">Boy</span><br><b>${p.height} cm</b></span><span><span class="small">Hedef</span><br><b>${C.fmt1(p.target)} kg</b></span>
          <span><span class="small">Başlangıç</span><br><b>${p.startWeight ? C.fmt1(p.startWeight) + ' kg' : '—'}</b></span><span><span class="small">Dambıl</span><br><b>${DB.dumbbellKg ? C.fmtNum(DB.dumbbellKg) + ' kg' : '—'}</b></span>
        </div></section>
      <section class="card"><h2>Yedek</h2><p class="small">${days === null ? 'Henüz yedek alınmadı.' : `Son yedek: ${days === 0 ? 'bugün' : days + ' gün önce'}.`} Veriler yalnızca bu cihazda; Safari verilerini silersen ya da telefon değiştirirsen yedek dosyasından geri yüklersin.</p>
        <div class="grid2"><button class="btn mid" data-a="open-export">Dışa aktar</button><button class="btn mid sec" data-a="import">İçe aktar</button></div></section>
      <section class="card"><h2>Hareketler</h2>
        ${hidden.length ? `<p class="small">Önerilmeyen hareketler:</p><ul class="list">${hidden.map((e) => `<li class="between" style="padding:6px 0"><span>${esc(e.name)}</span><button class="link" data-a="unhide" data-id="${e.id}">Geri getir</button></li>`).join('')}</ul>` : '<p class="small">Gizlediğin hareket yok. Bir hareket ağrı yaparsa kayıt ekranından “önerme” diyebilirsin.</p>'}
        ${customs.length ? `<p class="small">Eklediğin hareketler:</p><ul class="list">${customs.map((e) => `<li class="between" style="padding:6px 0"><span>${esc(e.name)} <span class="small">· ${esc(C.GROUPS[e.g].name)}</span></span><button class="link danger" data-a="del-custom" data-id="${e.id}">Sil</button></li>`).join('')}</ul>` : ''}
      </section>
      <section class="card"><h2>Güvenlik</h2>
        <div class="grid2"><button class="btn mid sec" data-a="change-pin">Şifreyi değiştir</button><button class="btn mid sec" data-a="lock">Şimdi kilitle</button></div>
        <p class="tiny">Uygulama arka plana alınıp 2 dakika geçince kendini kilitler.</p></section>
      <button class="btn danger" data-a="wipe">Tüm verileri sil</button>
      <p class="tiny" style="text-align:center">Tartı ${VERSION} · Veriler bu cihazda, şifreli. BMI kategorileri WHO yetişkin sınıflamasıdır. Tıbbi tavsiye yerine geçmez; bir hareket ağrı yaparsa dur.</p>
    </section>`;
  }

  // ---------- alt sayfalar ----------
  function sheetView() {
    if (ui.sheet === 'export') {
      const opts = [['30', 'Son 30 gün'], ['90', 'Son 90 gün'], ['all', 'Tümü']];
      return `<div class="sheet-bg" data-a="close-sheet"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="shT" data-stop="1">
        <h2 id="shT">Dışa aktar</h2>
        <p class="small">Profil, kilo ve antrenman kayıtların tek bir CSV dosyası olur. Excel'de açılır; içe aktarmada yedek olarak da çalışır. Yorumlatmak için dosyayı Claude'a gönderebilirsin.</p>
        <div class="seg" role="group" aria-label="Aralık">${opts.map(([k, l]) => `<button type="button" data-a="exp-range" data-val="${k}" aria-pressed="${ui.exportRange === k}">${l}</button>`).join('')}</div>
        <p class="tiny">Tam yedek için “Tümü”nü seç.</p>
        <button class="btn" data-a="do-export">${I.share} Dosyayı paylaş</button>
        <button class="btn sec" data-a="close-sheet">Vazgeç</button></div></div>`;
    }
    if (ui.sheet === 'custom') {
      const c = ui.custom || (ui.custom = { name: '', g: 'core', unit: 'reps' });
      return `<div class="sheet-bg" data-a="close-sheet"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="shC" data-stop="1">
        <h2 id="shC">Yeni hareket</h2>
        <div class="field"><label for="cname">Adı</label><input id="cname" class="input" data-cf="name" value="${esc(c.name)}" placeholder="Ör. Merdiven çıkma" autocomplete="off"></div>
        <div class="field"><span class="flabel" id="cgL">Hangi kas grubunu çalıştırıyor?</span><div class="chips" role="group" aria-labelledby="cgL">
          ${C.GROUP_ORDER.map((g) => `<button type="button" class="chip" data-a="cset" data-k="g" data-val="${g}" aria-pressed="${c.g === g}">${esc(C.GROUPS[g].name)}</button>`).join('')}</div></div>
        <div class="field"><span class="flabel" id="cuL">Nasıl ölçülüyor?</span><div class="seg" role="group" aria-labelledby="cuL">
          ${[['reps', 'Tekrar'], ['sec', 'Saniye'], ['min', 'Dakika']].map(([u, l]) => `<button type="button" data-a="cset" data-k="unit" data-val="${u}" aria-pressed="${c.unit === u}">${l}</button>`).join('')}</div></div>
        <p class="err">${esc(c._err || '')}</p>
        <button class="btn" data-a="save-custom">Ekle</button><button class="btn sec" data-a="close-sheet">Vazgeç</button></div></div>`;
    }
    return '';
  }

  // ---------- dışa / içe aktarma ----------
  async function doExport() {
    const from = ui.exportRange === 'all' ? null : C.addDays(today(), -parseInt(ui.exportRange, 10));
    const csv = C.toCSV(DB, from);
    const name = `tarti-${today()}${from ? '-son' + ui.exportRange + 'gun' : ''}.csv`;
    const file = new File([csv], name, { type: 'text/csv' });
    let ok = false;
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Tartı kayıtları' }); ok = true; }
    } catch (e) { if (e.name === 'AbortError') return; }
    if (!ok) {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000); ok = true;
    }
    if (ok && ui.exportRange === 'all') { DB.lastBackup = new Date().toISOString(); await commit(); }
    ui.sheet = null; render(); toast('Dosya hazır');
  }
  const fileIn = document.createElement('input');
  fileIn.type = 'file'; fileIn.accept = '.csv,text/csv,text/plain'; fileIn.style.display = 'none';
  document.body.appendChild(fileIn);
  fileIn.addEventListener('change', async () => {
    const file = fileIn.files && fileIn.files[0]; fileIn.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const res = C.importCSV(DB, text, uid);
      if (res.profile && res.profile.height && (!DB.profile || ui.view === 'onboard')) DB.profile = { ...res.profile, createdAt: today() };
      await commit();
      toast(`${res.weights} kilo, ${res.workouts} antrenman kaydı alındı${res.skipped ? ` (${res.skipped} satır atlandı)` : ''}`);
      ui.form = {};
      go(DB.profile ? (ui.view === 'onboard' ? 'home' : ui.view) : 'onboard');
    } catch (e) { toast('İçe aktarılamadı: ' + e.message); }
  });

  // ---------- olaylar ----------
  const A = {
    tab: (el) => go(el.dataset.v),
    nav: (el) => { ui.form = {}; go(el.dataset.v); },
    back: () => { ui.form = {}; go(TABS.some((t) => t[0] === ui.from) ? ui.from : 'home'); },
    noop: () => {},
    key: (el) => {
      if (ui.busy || ui.lockedUntil > Date.now() || ui.pin.length >= 6) { if (ui.lockedUntil > Date.now()) render(); return; }
      ui.pin += el.dataset.k; ui.pinErr = '';
      if (ui.pin.length === 6) onPinComplete(); else render();
    },
    del: () => { if (!ui.busy) { ui.pin = ui.pin.slice(0, -1); render(); } },
    'pin-cancel': () => { resetPin(); go('profile'); },
    forgot: () => {
      alert('Şifre olmadan veriler açılamaz; bu tasarım gereği.\n\nYedek dosyan (CSV) varsa: verileri silip yeni şifre belirle, sonra ilk ekrandan “Yedekten geri yükle” de.');
      if (confirm('Bu cihazdaki tüm Tartı verilerini silip yeniden başlamak istiyor musun?') && confirm('Emin misin? Bu geri alınamaz.')) wipe();
    },
    set: (el) => { ui.form[el.dataset.k] = el.dataset.val; render(); },
    'save-profile': (el) => saveProfile(!!el.dataset.onboard),
    'edit-profile': () => { ui.form = {}; go('editProfile'); },
    'new-weight': () => openWeight(null),
    'edit-weight': (el) => openWeight(DB.weights.find((w) => w.id === el.dataset.id)),
    'kg-step': (el) => { const v = C.parseNum(ui.form.kg); const n = (isNaN(v) ? (C.latestWeight(DB) || { kg: 80 }).kg : v) + parseFloat(el.dataset.d); ui.form.kg = C.fmt1(clamp(n, 30, 300)); render(); },
    'set-date': (el) => { ui.form.date = el.dataset.val; render(); },
    'save-weight': () => saveWeight(),
    'del-weight': async (el) => {
      const id = el.dataset.id || ui.form.editId; const w = DB.weights.find((x) => x.id === id); if (!w) return;
      if (!confirm(`${C.fmtDate(w.date)} · ${C.fmt1(w.kg)} kg kaydı silinsin mi?`)) return;
      DB.weights = DB.weights.filter((x) => x.id !== id); await commit('Silindi');
      if (ui.view === 'addWeight') { ui.form = {}; go(ui.from === 'history' ? 'history' : 'home'); } else render();
    },
    mode: (el) => { ui.mode = el.dataset.val; render(); },
    range: (el) => { ui.range = el.dataset.val; render(); },
    'did-plan': () => { const r = C.recommend(DB); if (r.plan) openWorkout({ plan: r.plan }); },
    'new-workout': () => openWorkout(null),
    'edit-workout': (el) => openWorkout({ rec: DB.workouts.find((w) => w.id === el.dataset.id) }),
    'pick-ex': (el) => { pickExercise(el.dataset.id); ui.form.showList = false; render(); },
    'show-list': () => { ui.form.showList = true; render(); },
    sets: (el) => { ui.form.sets = clamp(ui.form.sets + parseInt(el.dataset.d, 10), 1, 10); render(); },
    amt: (el) => {
      const ex = C.exById(DB, ui.form.ex); const st = ex.unit === 'reps' ? 1 : 5;
      ui.form.amount = clamp(ui.form.amount + st * parseInt(el.dataset.d, 10), st, ex.unit === 'reps' ? 200 : ex.unit === 'sec' ? 1800 : 600); render();
    },
    'save-workout': () => saveWorkout(),
    'del-workout': async (el) => {
      const id = el.dataset.id; const w = DB.workouts.find((x) => x.id === id); if (!w) return;
      if (!confirm(`${C.fmtDate(w.date)} · ${C.fmtWorkout(DB, w)} silinsin mi?`)) return;
      DB.workouts = DB.workouts.filter((x) => x.id !== id); await commit('Silindi');
      if (ui.view === 'addWorkout') { ui.form = {}; go(TABS.some((t) => t[0] === ui.from) ? ui.from : 'train'); } else render();
    },
    'hide-ex': async (el) => {
      const ex = C.exById(DB, el.dataset.id);
      if (!confirm(`“${ex.name}” bundan sonra önerilmesin mi? Profil'den geri getirebilirsin.`)) return;
      DB.hidden = [...new Set([...(DB.hidden || []), ex.id])]; ui.form.ex = null; await commit('Bu hareket artık önerilmeyecek'); render();
    },
    unhide: async (el) => { DB.hidden = (DB.hidden || []).filter((x) => x !== el.dataset.id); await commit('Geri getirildi'); render(); },
    'del-custom': async (el) => {
      const id = el.dataset.id; const used = DB.workouts.some((w) => w.ex === id);
      if (used) { toast('Bu hareketle kayıt var; önce kayıtları sil ya da gizle.'); return; }
      if (!confirm('Bu hareket silinsin mi?')) return;
      DB.customExercises = DB.customExercises.filter((e) => e.id !== id); await commit('Silindi'); render();
    },
    'open-custom': () => { ui.custom = { name: '', g: 'core', unit: 'reps' }; ui.sheet = 'custom'; render(); setTimeout(() => { const i = document.getElementById('cname'); if (i) i.focus(); }, 50); },
    cset: (el) => { ui.custom[el.dataset.k] = el.dataset.val; render(); },
    'save-custom': async () => {
      const c = ui.custom; const name = (c.name || '').trim();
      if (name.length < 2) { c._err = 'Bir ad yaz.'; return render(); }
      if (C.allExercises(DB).some((e) => e.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'))) { c._err = 'Bu adda bir hareket zaten var.'; return render(); }
      const ex = { id: 'c_' + uid(), name, g: c.g, unit: c.unit };
      DB.customExercises.push(ex); await commit('Hareket eklendi');
      ui.sheet = null; pickExercise(ex.id); ui.form.showList = false; render();
    },
    toggle: (el) => { ui.openId = ui.openId === el.dataset.id ? null : el.dataset.id; render(); },
    hist: (el) => { ui.hist = el.dataset.val; ui.openId = null; render(); },
    'open-export': () => { ui.sheet = 'export'; render(); },
    'exp-range': (el) => { ui.exportRange = el.dataset.val; render(); },
    'do-export': () => doExport(),
    'close-sheet': (el, e) => { if (e.target.closest('[data-stop]') && el.classList.contains('sheet-bg')) return; ui.sheet = null; render(); },
    import: () => { if (ui.view !== 'onboard' && !confirm('Dosyadaki kayıtlar mevcut kayıtlarla birleştirilecek (aynı kayıtlar güncellenir). Devam?')) return; fileIn.click(); },
    'snooze-backup': () => { prefs.backupSnooze = today(); savePrefs(); render(); },
    'dismiss-install': () => { prefs.installDismissed = true; savePrefs(); render(); },
    'change-pin': () => { resetPin(); ui.pinMode = 'change-old'; go('lock'); },
    lock: () => lockNow(),
    wipe: () => { if (confirm('Bu cihazdaki tüm kilo ve antrenman kayıtların silinecek. Önce dışa aktarmak isteyebilirsin.\n\nDevam?') && confirm('Emin misin? Bu geri alınamaz.')) wipe(); }
  };
  function wipe() { localStorage.removeItem(STORE); KEY = null; DB = null; resetPin(); ui.pinMode = 'setup'; ui.fails = 0; ui.lockedUntil = 0; go('lock'); toast('Veriler silindi'); }

  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-a]');
    if (!el || !app.contains(el)) return;
    if (el.classList.contains('sheet-bg') && e.target.closest('[data-stop]')) return;
    const fn = A[el.dataset.a];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
  app.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.f) {
      ui.form[el.dataset.f] = el.value;
      if (el.dataset.f === 'height') { const h = document.getElementById('rangeHint'); if (h) h.textContent = rangeHint(el.value); }
      if (el.dataset.live === 'bmi') { const b = document.getElementById('bmiPreview'); if (b) b.innerHTML = bmiPreview(C.parseNum(el.value), DB && DB.profile); }
    }
    if (el.dataset.cf) ui.custom[el.dataset.cf] = el.value;
  });
  app.addEventListener('change', (e) => { if (e.target.dataset.live === 'rerender') { ui.form[e.target.dataset.f] = e.target.value; render(); } });
  document.addEventListener('keydown', (e) => {
    if (ui.view !== 'lock' || e.target.tagName === 'INPUT') return;
    if (/^\d$/.test(e.key)) A.key({ dataset: { k: e.key } });
    else if (e.key === 'Backspace') A.del();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) ui.hiddenAt = Date.now();
    else if (KEY && ui.hiddenAt && Date.now() - ui.hiddenAt > AUTOLOCK_MS) lockNow();
  });

  // ---------- başlat ----------
  if (!window.crypto || !crypto.subtle) {
    app.innerHTML = '<section class="screen no-tabs"><div class="card"><h2>Güvenli bağlantı gerekli</h2><p class="small">Tartı yalnızca https üzerinden açıldığında çalışır.</p></div></section>';
    return;
  }
  ui.pinMode = hasStore() ? 'unlock' : 'setup';
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') window.__tarti = { ui, get DB() { return DB; } }; // yalnızca yerel test
})();
