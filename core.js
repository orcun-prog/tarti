/* Tartı — çekirdek: tarih, BMI, hareket kataloğu, öneri motoru, CSV.
   Arayüzden bağımsızdır; tarayıcıda window.Core, Node'da module.exports. */
(function (root) {
  'use strict';

  // ---------- Tarih ----------
  const pad = (n) => String(n).padStart(2, '0');
  const toStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = () => toStr(new Date());
  const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return toStr(d); };
  const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000); // b - a
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parseDate(s));

  const AY = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const AY_KISA = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  const GUN = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  const GUN_KISA = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

  function fmtDate(s, withDay, today) {
    const t = today || todayStr();
    if (s === t) return 'Bugün';
    if (s === addDays(t, -1)) return 'Dün';
    const d = parseDate(s);
    const y = d.getFullYear() !== parseDate(t).getFullYear() ? ' ' + d.getFullYear() : '';
    return `${d.getDate()} ${AY_KISA[d.getMonth()]}${y}${withDay ? ', ' + GUN_KISA[d.getDay()] : ''}`;
  }
  const fmtLongToday = (t) => { const d = parseDate(t || todayStr()); return `${GUN[d.getDay()]}, ${d.getDate()} ${AY[d.getMonth()]}`; };

  // ---------- Sayı ----------
  const fmt1 = (n) => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');
  const fmtNum = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100).replace('.', ','));
  const parseNum = (s) => { if (s == null) return NaN; const t = String(s).trim().replace(/\s/g, '').replace(',', '.'); return t === '' ? NaN : Number(t); };

  // ---------- BMI ----------
  const bmi = (kg, cm) => kg / ((cm / 100) * (cm / 100));
  function bmiCat(b) {
    if (b < 18.5) return { key: 'under', label: 'Zayıf', bg: '#DBEAFE', fg: '#1E40AF' };
    if (b < 25) return { key: 'normal', label: 'Normal', bg: '#DCFCE7', fg: '#166534' };
    if (b < 30) return { key: 'over', label: 'Fazla kilolu', bg: '#FEF3C7', fg: '#92400E' };
    return { key: 'obese', label: 'Obez', bg: '#FEE2E2', fg: '#991B1B' };
  }
  const normalRange = (cm) => { const h = (cm / 100) ** 2; return [18.5 * h, 24.9 * h]; };

  // ---------- Kas grupları ve hareketler ----------
  const GROUPS = {
    legs: { name: 'Bacak & kalça', long: 'Bacak & kalça' },
    push: { name: 'İtiş', long: 'İtiş (göğüs, omuz, arka kol)' },
    pull: { name: 'Çekiş', long: 'Çekiş (sırt, ön kol)' },
    core: { name: 'Core', long: 'Core (karın, bel)' },
    cardio: { name: 'Kardiyo', long: 'Kardiyo' }
  };
  const GROUP_ORDER = ['legs', 'push', 'pull', 'core', 'cardio'];
  const STRENGTH = ['legs', 'push', 'pull', 'core'];
  const REST_DAYS = 2; // kuvvet çalışan grup en az 2 takvim günü sonra tekrar (≈48 saat)

  // lvl: aynı gruptaki kolaydan zora sıra. side: ana sıranın dışındaki alternatif.
  const BASE_EXERCISES = [
    { id: 'sit_stand', name: 'Sandalyeden kalk-otur', g: 'legs', unit: 'reps', start: 10, step: 2, cap: 20, lvl: 1, tip: 'Kollarını kullanmadan kalk, yavaşça otur.' },
    { id: 'squat', name: 'Squat', g: 'legs', unit: 'reps', start: 12, step: 2, cap: 24, lvl: 2, first: true, tip: 'Ayaklar omuz genişliğinde; kalça geriye, dizler ayak uçlarıyla aynı yöne.' },
    { id: 'db_squat', name: 'Dambıllı squat', g: 'legs', unit: 'reps', start: 10, step: 2, cap: 20, lvl: 3, w: true, tip: 'Dambılı iki elle göğüs hizasında tut.' },
    { id: 'lunge', name: 'Geri adım lunge (her bacak)', g: 'legs', unit: 'reps', start: 8, step: 1, cap: 15, lvl: 4, tip: 'Geriye adım at, arka diz yere yaklaşsın. Denge için sandalyeye tutunabilirsin.' },
    { id: 'bridge', name: 'Kalça köprüsü', g: 'legs', unit: 'reps', start: 12, step: 2, cap: 25, side: true, tip: 'Sırtüstü yat, dizler bükük; kalçanı sıkarak kaldır, 1 sn bekle.' },
    { id: 'wall_sit', name: 'Duvarda oturma', g: 'legs', unit: 'sec', start: 30, step: 10, cap: 90, side: true, tip: 'Sırt duvarda; dizler 90 dereceden fazla bükülmesin.' },

    { id: 'wall_push', name: 'Duvar şınavı', g: 'push', unit: 'reps', start: 10, step: 2, cap: 20, lvl: 1, tip: 'Kollar omuz hizasında duvarda; vücut dümdüz.' },
    { id: 'incline_push', name: 'Sandalyeye dayanarak şınav', g: 'push', unit: 'reps', start: 8, step: 1, cap: 15, lvl: 2, first: true, tip: 'Sandalyeyi duvara daya ki kaymasın. Vücut dümdüz.' },
    { id: 'knee_push', name: 'Diz şınavı', g: 'push', unit: 'reps', start: 8, step: 1, cap: 15, lvl: 3, tip: 'Dizler matta; kalçayı düşürme.' },
    { id: 'pushup', name: 'Şınav', g: 'push', unit: 'reps', start: 5, step: 1, cap: 20, lvl: 4, tip: 'Göğüs yere yaklaşsın, dirsekler gövdeye 45 derece.' },
    { id: 'db_press', name: 'Oturarak dambıl omuz press', g: 'push', unit: 'reps', start: 10, step: 1, cap: 15, w: true, side: true, tip: 'Sandalyede dik otur; dambılları kulak hizasından yukarı it.' },

    { id: 'superman', name: 'Süpermen', g: 'pull', unit: 'reps', start: 10, step: 2, cap: 20, lvl: 1, tip: 'Yüzüstü; kol ve bacakları birlikte hafifçe kaldır, 2 sn bekle.' },
    { id: 'db_row', name: 'Tek kol dambıl row (her kol)', g: 'pull', unit: 'reps', start: 10, step: 1, cap: 15, lvl: 2, w: true, first: true, tip: 'Bir el ve diz sandalyede; dambılı kalçana doğru çek.' },
    { id: 'curl', name: 'Dambıl biceps curl', g: 'pull', unit: 'reps', start: 10, step: 1, cap: 15, w: true, side: true, tip: 'Dirsekler gövdede sabit; yavaşça indir.' },

    { id: 'bird_dog', name: 'Bird dog (her taraf)', g: 'core', unit: 'reps', start: 8, step: 1, cap: 15, lvl: 1, tip: 'Dört ayak üstünde; çapraz kol ve bacağı uzat, beli çukurlaştırma.' },
    { id: 'dead_bug', name: 'Dead bug (her taraf)', g: 'core', unit: 'reps', start: 8, step: 1, cap: 15, lvl: 2, tip: 'Sırtüstü; bel mata yapışık kalsın.' },
    { id: 'knee_plank', name: 'Diz üstü plank', g: 'core', unit: 'sec', start: 20, step: 10, cap: 60, lvl: 3, tip: 'Dirsekler omuz altında, dizler matta.' },
    { id: 'plank', name: 'Plank', g: 'core', unit: 'sec', start: 20, step: 10, cap: 120, lvl: 4, first: true, tip: 'Dirsekler omuz altında; kalça ne yukarıda ne aşağıda.' },
    { id: 'side_plank', name: 'Yan plank (her taraf)', g: 'core', unit: 'sec', start: 15, step: 5, cap: 60, side: true, tip: 'Zorsa alttaki dizini yere koy.' },

    { id: 'walk', name: 'Yürüyüş', g: 'cardio', unit: 'min', start: 20, step: 5, cap: 60, first: true, single: true, tip: 'Konuşabileceğin ama şarkı söyleyemeyeceğin tempo.' },
    { id: 'march', name: 'Yerinde tempolu yürüyüş', g: 'cardio', unit: 'min', start: 10, step: 5, cap: 30, single: true, tip: 'Dizleri hafif kaldırarak, kolları sallayarak.' }
  ];
  const UNIT_STEP = { reps: 2, sec: 10, min: 5 };

  function allExercises(db) {
    const custom = (db.customExercises || []).map((c) => ({
      step: UNIT_STEP[c.unit] || 1, cap: Infinity, start: c.unit === 'reps' ? 10 : c.unit === 'sec' ? 30 : 20,
      single: c.unit === 'min', custom: true, side: true, ...c
    }));
    return BASE_EXERCISES.concat(custom);
  }
  const exById = (db, id) => allExercises(db).find((e) => e.id === id);
  const isHidden = (db, id) => (db.hidden || []).includes(id);

  function fmtAmount(ex, amount) {
    if (!ex) return String(amount);
    if (ex.unit === 'sec') return amount >= 60 ? `${Math.floor(amount / 60)}:${pad(amount % 60)} dk` : `${amount} sn`;
    if (ex.unit === 'min') return `${amount} dk`;
    return String(amount);
  }
  function fmtWorkout(db, w) {
    const ex = exById(db, w.ex);
    const amt = fmtAmount(ex, w.amount);
    const base = ex && ex.single && w.sets === 1 ? amt : `${w.sets} × ${amt}`;
    const name = ex ? ex.name : w.exName || 'Hareket';
    return `${base} ${name.toLocaleLowerCase('tr')}${ex && ex.w && w.kg ? ` · ${fmtNum(w.kg)} kg` : ''}`;
  }
  const FEEL = { kolay: 'Kolay', tam: 'Tam kararında', zor: 'Zordu' };

  // Kayıtları tarih (sonra giriş anı) sırasına göre, en yeni sonda
  const sortRecs = (a) => a.slice().sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : (x.ts || 0) - (y.ts || 0)));

  function lastOfEx(db, exId, beforeOrOn) {
    const list = sortRecs(db.workouts.filter((w) => w.ex === exId && (!beforeOrOn || w.date <= beforeOrOn)));
    return list[list.length - 1] || null;
  }
  function lastOfGroup(db, g, beforeOrOn) {
    const list = sortRecs(db.workouts.filter((w) => { const e = exById(db, w.ex); return e && e.g === g && (!beforeOrOn || w.date <= beforeOrOn); }));
    return list[list.length - 1] || null;
  }

  function ladderNext(db, ex) {
    if (ex.side || ex.custom || !ex.lvl) return null;
    return BASE_EXERCISES.filter((e) => e.g === ex.g && e.lvl > ex.lvl && !isHidden(db, e.id)).sort((a, b) => a.lvl - b.lvl)[0] || null;
  }

  // Bir hareket için sıradaki hedef (set, miktar)
  function progress(db, ex) {
    const last = lastOfEx(db, ex.id);
    if (!last) return { ex, sets: ex.single ? 1 : 2, amount: ex.start, kg: lastKg(db, ex), last: null, note: '' };
    const kg = last.kg || lastKg(db, ex);
    if (last.feel === 'zor') return { ex, sets: last.sets, amount: last.amount, kg, last, note: 'Geçen sefer zordu; aynı seviyede kalıyoruz.' };
    const inc = last.feel === 'kolay' ? 2 * ex.step : ex.step;
    let amount = last.amount + inc;
    if (ex.single) return { ex, sets: 1, amount: Math.min(amount, ex.cap), kg, last, note: amount > ex.cap ? 'Üst sınırdasın.' : '' };
    if (amount <= ex.cap) return { ex, sets: last.sets, amount, kg, last, note: '' };
    if (last.sets < 3) {
      const mid = Math.round((ex.start + ex.cap) / 2 / ex.step) * ex.step;
      return { ex, sets: last.sets + 1, amount: Math.max(ex.start, mid), kg, last, note: 'Bir set daha ekliyoruz.' };
    }
    const nxt = ladderNext(db, ex);
    if (nxt) return { ex: nxt, sets: 2, amount: nxt.start, kg: lastKg(db, nxt), last: null, note: `${ex.name} tamam; bir üst seviyeye geçiyoruz.` };
    return { ex, sets: last.sets, amount: Math.min(last.amount, ex.cap === Infinity ? last.amount : ex.cap), kg, last, note: ex.w ? 'Üst sınırdasın; daha ağır bir dambılın varsa geçebilirsin.' : 'Üst sınırdasın; böyle devam.' };
  }
  function lastKg(db, ex) {
    if (!ex.w) return null;
    const last = lastOfEx(db, ex.id);
    if (last && last.kg) return last.kg;
    return db.dumbbellKg || null;
  }

  function currentExForGroup(db, g) {
    const last = lastOfGroup(db, g);
    if (last && !isHidden(db, last.ex) && exById(db, last.ex)) return exById(db, last.ex);
    const list = allExercises(db).filter((e) => e.g === g && !isHidden(db, e.id));
    return list.find((e) => e.first) || list.filter((e) => e.lvl).sort((a, b) => a.lvl - b.lvl)[0] || list[0] || null;
  }

  function groupStatus(db, today) {
    const t = today || todayStr();
    return GROUP_ORDER.map((g) => {
      const last = lastOfGroup(db, g, t);
      const ds = last ? daysBetween(last.date, t) : Infinity;
      const ready = g === 'cardio' ? true : ds >= REST_DAYS;
      const readyIn = g === 'cardio' || ready ? 0 : REST_DAYS - ds;
      return { g, last, ds, ready, readyIn };
    });
  }

  // Bugünün önerisi
  function recommend(db, today) {
    const t = today || todayStr();
    const todays = db.workouts.filter((w) => w.date === t);
    const gOf = (w) => { const e = exById(db, w.ex); return e ? e.g : null; };
    const strengthToday = todays.some((w) => STRENGTH.includes(gOf(w)));
    const cardioToday = todays.some((w) => gOf(w) === 'cardio');
    const st = groupStatus(db, t);

    const cardioPick = () => {
      const ex = currentExForGroup(db, 'cardio');
      return ex ? progress(db, ex) : null;
    };

    if (strengthToday) {
      return { kind: cardioToday ? 'done' : 'done-cardio', group: 'cardio', plan: cardioToday ? null : cardioPick(), reason: cardioToday ? 'Bugünlük tamam. Yarın yeni öneri gelir.' : 'Bugünkü kuvvet çalışması tamam. İstersen bir de yürüyüş:' };
    }
    const ready = st.filter((s) => STRENGTH.includes(s.g) && s.ready && currentExForGroup(db, s.g));
    if (ready.length) {
      ready.sort((a, b) => (b.ds === a.ds ? STRENGTH.indexOf(a.g) - STRENGTH.indexOf(b.g) : b.ds > a.ds ? 1 : -1));
      const pick = ready[0];
      const plan = progress(db, currentExForGroup(db, pick.g));
      const why = pick.ds === Infinity ? 'henüz hiç çalışmadı' : pick.ds === REST_DAYS ? 'dinlendi, hazır' : `${pick.ds} gündür çalışmadı`;
      return { kind: 'strength', group: pick.g, plan, reason: `${GROUPS[pick.g].name} ${why}` };
    }
    if (!cardioToday) return { kind: 'cardio', group: 'cardio', plan: cardioPick(), reason: 'Kas grupların dinleniyor; bugün hafif kardiyo günü.' };
    return { kind: 'rest', group: null, plan: null, reason: 'Bugün dinlenme günü. Kaslar dinlenirken güçlenir.' };
  }

  // ---------- Kilo istatistikleri ----------
  const sortedWeights = (db) => sortRecs(db.weights);
  function latestWeight(db) { const s = sortedWeights(db); return s[s.length - 1] || null; }
  // Doğrusal eğilim: kg/hafta. Son `days` gün içindeki kayıtlar.
  function weeklyRate(points) {
    if (points.length < 2) return null;
    const x0 = parseDate(points[0].date);
    const xs = points.map((p) => (parseDate(p.date) - x0) / 86400000);
    if (xs[xs.length - 1] - xs[0] < 3) return null;
    const ys = points.map((p) => p.kg);
    const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    return den ? (num / den) * 7 : null;
  }
  function recentRate(db, days, today) {
    const t = today || todayStr();
    const from = addDays(t, -days);
    return weeklyRate(sortedWeights(db).filter((w) => w.date >= from && w.date <= t));
  }

  // ---------- CSV ----------
  const COLS = ['kayit_id', 'tarih', 'tur', 'kilo_kg', 'bmi', 'hareket_id', 'hareket', 'kas_grubu', 'set', 'tekrar', 'sure_sn', 'dambil_kg', 'zorluk', 'not'];
  const cell = (v) => { const s = v == null ? '' : String(v); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csvNum = (n) => (n == null || n === '' || isNaN(n) ? '' : String(Math.round(n * 100) / 100).replace('.', ','));

  function toCSV(db, fromDate) {
    const p = db.profile || {};
    const rows = [COLS.join(';')];
    rows.push([
      'profil', '', 'profil', csvNum(p.startWeight), '', '', '', '', '', '', '', '', '',
      `cinsiyet:${p.sex === 'k' ? 'kadın' : 'erkek'}, yaş:${p.age ?? ''}, boy_cm:${p.height ?? ''}, hedef_kg:${csvNum(p.target)}, dambil_kg:${csvNum(db.dumbbellKg)}`
    ].map(cell).join(';'));
    const recs = [];
    for (const w of db.weights) if (!fromDate || w.date >= fromDate) recs.push({ k: 'kilo', r: w });
    for (const w of db.workouts) if (!fromDate || w.date >= fromDate) recs.push({ k: 'antrenman', r: w });
    recs.sort((a, b) => (a.r.date < b.r.date ? -1 : a.r.date > b.r.date ? 1 : (a.r.ts || 0) - (b.r.ts || 0)));
    for (const { k, r } of recs) {
      if (k === 'kilo') {
        rows.push([r.id, r.date, 'kilo', csvNum(r.kg), p.height ? csvNum(bmi(r.kg, p.height)) : '', '', '', '', '', '', '', '', '', r.note || ''].map(cell).join(';'));
      } else {
        const ex = exById(db, r.ex);
        const unit = ex ? ex.unit : 'reps';
        rows.push([
          r.id, r.date, 'antrenman', '', '', r.ex, ex ? ex.name : r.exName || '', ex ? GROUPS[ex.g].name : '',
          r.sets, unit === 'reps' ? r.amount : '', unit === 'sec' ? r.amount : unit === 'min' ? r.amount * 60 : '',
          csvNum(r.kg), FEEL[r.feel] || '', r.note || ''
        ].map(cell).join(';'));
      }
    }
    return '﻿' + rows.join('\r\n') + '\r\n';
  }

  function parseCSVText(text) {
    text = text.replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
    const rows = []; let row = []; let cur = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
      } else if (c === '"') q = true;
      else if (c === sep) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim() !== ''));
  }

  const FEEL_BACK = { 'kolay': 'kolay', 'tam kararında': 'tam', 'tam': 'tam', 'zordu': 'zor', 'zor': 'zor' };
  function groupFromName(name) {
    const n = (name || '').toLocaleLowerCase('tr').trim();
    for (const g of GROUP_ORDER) if (GROUPS[g].name.toLocaleLowerCase('tr') === n || GROUPS[g].long.toLocaleLowerCase('tr') === n || g === n) return g;
    return null;
  }

  // CSV'yi db'ye birleştirir (aynı kayit_id varsa günceller). Sonuç özeti döner.
  function importCSV(db, text, newId) {
    const rows = parseCSVText(text);
    if (!rows.length) throw new Error('Dosya boş.');
    const head = rows[0].map((h) => h.trim().toLocaleLowerCase('tr'));
    const ix = (name) => head.indexOf(name);
    if (ix('tarih') < 0 || ix('tur') < 0) throw new Error('Bu dosya bir Tartı yedeği gibi görünmüyor.');
    const get = (r, name) => { const i = ix(name); return i < 0 ? '' : (r[i] || '').trim(); };
    let nW = 0, nA = 0, profile = null, skipped = 0;
    db.customExercises = db.customExercises || [];
    for (const r of rows.slice(1)) {
      const tur = get(r, 'tur').toLocaleLowerCase('tr');
      if (tur === 'profil') {
        const note = get(r, 'not');
        const m = (k) => { const mm = note.match(new RegExp(k + ':\\s*([^,]+)')); return mm ? mm[1].trim() : ''; };
        profile = {
          sex: /kad/i.test(m('cinsiyet')) ? 'k' : 'e',
          age: parseInt(m('yaş'), 10) || null,
          height: parseNum(m('boy_cm')) || null,
          target: parseNum(m('hedef_kg')) || null,
          startWeight: parseNum(get(r, 'kilo_kg')) || null
        };
        const dk = parseNum(m('dambil_kg'));
        if (dk) db.dumbbellKg = db.dumbbellKg || dk;
        continue;
      }
      const date = get(r, 'tarih');
      if (!isDate(date)) { skipped++; continue; }
      const id = get(r, 'kayit_id') || newId();
      if (tur === 'kilo') {
        const kg = parseNum(get(r, 'kilo_kg'));
        if (!(kg > 0)) { skipped++; continue; }
        const rec = { id, date, kg, note: get(r, 'not'), ts: Date.now() };
        const i = db.weights.findIndex((w) => w.id === id);
        if (i >= 0) db.weights[i] = { ...db.weights[i], ...rec }; else db.weights.push(rec);
        nW++;
      } else if (tur === 'antrenman') {
        let exId = get(r, 'hareket_id');
        const exName = get(r, 'hareket');
        let ex = exId ? exById(db, exId) : allExercises(db).find((e) => e.name.toLocaleLowerCase('tr') === exName.toLocaleLowerCase('tr'));
        const secs = parseNum(get(r, 'sure_sn'));
        const reps = parseNum(get(r, 'tekrar'));
        if (!ex) {
          const g = groupFromName(get(r, 'kas_grubu')) || 'core';
          const unit = !isNaN(reps) ? 'reps' : g === 'cardio' ? 'min' : 'sec';
          exId = exId || 'c_' + newId();
          ex = { id: exId, name: exName || 'Hareket', g, unit };
          db.customExercises.push(ex);
          ex = exById(db, exId);
        }
        const amount = ex.unit === 'reps' ? reps : ex.unit === 'min' ? Math.round(secs / 60) : secs;
        if (!(amount > 0)) { skipped++; continue; }
        const rec = {
          id, date, ex: ex.id, sets: parseInt(get(r, 'set'), 10) || 1, amount,
          kg: parseNum(get(r, 'dambil_kg')) || null, feel: FEEL_BACK[get(r, 'zorluk').toLocaleLowerCase('tr')] || 'tam',
          note: get(r, 'not'), ts: Date.now()
        };
        if (ex.w && rec.kg && !db.dumbbellKg) db.dumbbellKg = rec.kg;
        const i = db.workouts.findIndex((w) => w.id === id);
        if (i >= 0) db.workouts[i] = { ...db.workouts[i], ...rec }; else db.workouts.push(rec);
        nA++;
      } else skipped++;
    }
    return { weights: nW, workouts: nA, profile, skipped };
  }

  const Core = {
    pad, todayStr, parseDate, addDays, daysBetween, isDate, fmtDate, fmtLongToday, AY, AY_KISA,
    fmt1, fmtNum, parseNum, bmi, bmiCat, normalRange,
    GROUPS, GROUP_ORDER, STRENGTH, BASE_EXERCISES, allExercises, exById, isHidden, fmtAmount, fmtWorkout, FEEL,
    sortRecs, lastOfEx, lastOfGroup, progress, currentExForGroup, groupStatus, recommend,
    sortedWeights, latestWeight, weeklyRate, recentRate,
    toCSV, parseCSVText, importCSV
  };
  root.Core = Core;
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof window !== 'undefined' ? window : globalThis);
