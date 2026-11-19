// «Дневник героя» — серверная логика (общая для всех обработчиков).
// Подключается внутри каждого обработчика: const L = require(`${__hooks}/hero_lib.js`)

const MEALS = ['Завтрак', 'Обед', 'Ужин', 'Перекус'];
const DEFAULTS = { kcal: 2200, p: 150, f: 70, c: 220, water: 2500, glass: 250, bonus: 0, bonusOn: 0 };

/* ---------- мелочи ---------- */
function pad(n) { return String(n).padStart(2, '0'); }
function dstr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function today() { return dstr(new Date()); }
function nowHM() { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function shiftDate(s, n) { const p = s.split('-').map(Number); const d = new Date(p[0], p[1] - 1, p[2] + n); return dstr(d); }
function shortDate(d) { return d.slice(8, 10) + '.' + d.slice(5, 7); }
function norm(s) { return String(s).toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”']/g, '').replace(/\s+/g, ' ').trim(); }
function num(v) { if (typeof v === 'number') return v; const n = parseFloat(String(v == null ? '' : v).replace(',', '.').replace(/[^\d.\-]/g, '')); return isNaN(n) ? null : n; }
function r1(v) { return Math.round(v * 10) / 10; }
function fmt(v) { return String(Math.round(v * 100) / 100).replace('.', ','); }
function signed(v) { const r = Math.round(v * 10) / 10; return (r > 0 ? '+' : r < 0 ? '−' : '±') + fmt(Math.abs(r)); }
function fmtGrams(e) { return e.pcs ? fmt(e.pcs) + ' шт' : fmt(e.grams) + ' г'; }
function sum(list) { return list.reduce((t, e) => { t.kcal += +e.kcal || 0; t.p += +e.p || 0; t.f += +e.f || 0; t.c += +e.c || 0; return t; }, { kcal: 0, p: 0, f: 0, c: 0 }); }
function mealByTime() { const h = new Date().getHours(); return h >= 4 && h < 11 ? 'Завтрак' : h >= 11 && h < 16 ? 'Обед' : h >= 16 && h < 22 ? 'Ужин' : 'Перекус'; }
function rid() { return $security.randomStringWithAlphabet(10, 'abcdefghijklmnopqrstuvwxyz0123456789'); }

/* ---------- доступ к данным одного пользователя ---------- */
function all(app, coll, uid, extra, params, sort) {
  return app.findRecordsByFilter(coll, 'user = {:u}' + (extra ? ' && ' + extra : ''), sort || '', 0, 0, Object.assign({ u: uid }, params || {}));
}
function one(app, coll, uid, extra, params) {
  try { return app.findFirstRecordByFilter(coll, 'user = {:u} && ' + extra, Object.assign({ u: uid }, params || {})); } catch (e) { return null; }
}
function newRec(app, coll, uid, data) {
  const r = new Record(app.findCollectionByNameOrId(coll));
  r.set('user', uid);
  Object.keys(data).forEach(k => r.set(k, data[k]));
  app.save(r);
  return r;
}

function jsonOf(rec, f) { try { const v = JSON.parse(rec.getString(f) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } }
function settings(app, uid) {
  const rec = one(app, 'settings', uid, 'id != ""');
  const s = Object.assign({}, DEFAULTS);
  if (rec) Object.assign(s, jsonOf(rec, 'data'));
  return s;
}
function saveSettings(app, uid, patch) {
  let rec = one(app, 'settings', uid, 'id != ""');
  let cur = {};
  if (rec) cur = jsonOf(rec, 'data');
  Object.assign(cur, patch);
  if (!rec) newRec(app, 'settings', uid, { data: cur });
  else { rec.set('data', cur); app.save(rec); }
}

/* ---------- продукты: общий справочник + личные ---------- */
function prodFromRec(r) {
  const name = r.getString('name');
  const aliases = r.getString('aliases').split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
  const keys = [norm(name)].concat(aliases.map(norm)).filter((v, j, a) => v && a.indexOf(v) === j);
  return { name, aliases: aliases.join(', '), keys, state: r.getString('state'), kcal: r.getFloat('kcal'), p: r.getFloat('p'), f: r.getFloat('f'), c: r.getFloat('c'), piece: r.getFloat('piece') || null, def: r.getBool('def'), src: r.getString('src') };
}
function products(app, uid) {
  const own = all(app, 'products', uid).map(prodFromRec);
  const seen = {}; own.forEach(p => { seen[norm(p.name)] = 1; });
  const glob = app.findRecordsByFilter('products_global', 'id != ""', '', 0, 0).map(prodFromRec).filter(p => !seen[norm(p.name)]);
  return own.concat(glob);
}
function compactProducts(list) {
  return list.map(p => ({ name: p.name, aliases: p.aliases, state: p.state, kcal: p.kcal, p: p.p, f: p.f, c: p.c, piece: p.piece, def: p.def ? 1 : 0, src: p.src || '' }));
}
function saveProduct(app, uid, p, alias) {
  const name = String(p.name || '').trim();
  if (!name) return;
  if (products(app, uid).some(x => norm(x.name) === norm(name))) return;
  const aliases = p.aliases || [norm(alias || ''), norm(name)].filter((v, i, a) => v && a.indexOf(v) === i).join(', ');
  newRec(app, 'products', uid, { name, aliases, state: p.state || '', kcal: num(p.kcal) || 0, p: num(p.p) || 0, f: num(p.f) || 0, c: num(p.c) || 0, piece: num(p.piece) || 0, def: false, src: p.src || 'вручную' });
}

/* ---------- то, что приложение получает при синхронизации ---------- */
function foodRow(r) {
  return { id: r.getString('eid'), date: r.getString('date'), time: r.getString('time'), meal: r.getString('meal'), name: r.getString('name'), grams: r.getFloat('grams'), kcal: r.getFloat('kcal'), p: r.getFloat('p'), f: r.getFloat('f'), c: r.getFloat('c'), src: r.getString('src') };
}
function pull(app, uid, b) {
  const t = today(), from = shiftDate(t, -(+b.days || 21)), histFrom = shiftDate(t, -200);
  const food = [], by = {};
  all(app, 'food', uid, 'date >= {:h}', { h: histFrom }, 'date,time').forEach(r => {
    const e = foodRow(r), d = e.date;
    const s = by[d] || (by[d] = { d, kcal: 0, p: 0, f: 0, c: 0 });
    s.kcal += e.kcal; s.p += e.p; s.f += e.f; s.c += e.c;
    if (d >= from) food.push(e);
  });
  const since = +b.kvSince || 0;
  return {
    today: t, now: Date.now(),
    settings: settings(app, uid),
    products: compactProducts(products(app, uid)),
    food, foodFrom: from,
    hist: Object.keys(by).sort().map(k => by[k]),
    water: all(app, 'water', uid, '', {}, 'date').map(r => ({ d: r.getString('date'), v: r.getFloat('ml') })),
    steps: [],
    weights: all(app, 'weights', uid, '', {}, 'date').map(r => ({ d: r.getString('date'), v: r.getFloat('kg') })),
    kv: all(app, 'kv', uid, 't > {:s}', { s: since }).map(r => ({ k: r.getString('k'), v: r.getString('v'), t: r.getFloat('t') })),
  };
}

/* ---------- очередь изменений с телефона ---------- */
function applyOp(app, uid, op) {
  const d = op.d || {};
  switch (op.type) {
    case 'food.add': {
      const eid = String(d.id || rid());
      if (one(app, 'food', uid, 'eid = {:e}', { e: eid })) return;
      newRec(app, 'food', uid, { eid, date: String(d.date || today()), time: String(d.time || ''), meal: String(d.meal || mealByTime()), name: String(d.name || ''), grams: +d.grams || 0, kcal: Math.round(+d.kcal || 0), p: r1(+d.p || 0), f: r1(+d.f || 0), c: r1(+d.c || 0), raw: String(d.raw || ''), src: String(d.src || 'Приложение') });
      return;
    }
    case 'food.del': { const r = one(app, 'food', uid, 'eid = {:e}', { e: String(d.id) }); if (r) app.delete(r); return; }
    case 'food.edit': {
      const r = one(app, 'food', uid, 'eid = {:e}', { e: String(d.id) }); if (!r) return;
      const g = +d.grams || 0, k = g / (r.getFloat('grams') || 1);
      r.set('kcal', Math.round(r.getFloat('kcal') * k)); r.set('p', r1(r.getFloat('p') * k)); r.set('f', r1(r.getFloat('f') * k)); r.set('c', r1(r.getFloat('c') * k)); r.set('grams', g);
      app.save(r); return;
    }
    case 'weight.set': setWeight(app, uid, String(d.date), num(d.kg)); return;
    case 'weight.del': { const r = one(app, 'weights', uid, 'date = {:d}', { d: String(d.date) }); if (r) app.delete(r); return; }
    case 'water.add': addWater(app, uid, String(d.date), +d.ml || 0); return;
    case 'water.set': { const r = one(app, 'water', uid, 'date = {:d}', { d: String(d.date) }); if (r) { r.set('ml', Math.max(0, +d.ml || 0)); app.save(r); } else newRec(app, 'water', uid, { date: String(d.date), ml: Math.max(0, +d.ml || 0) }); return; }
    case 'settings.set': saveSettings(app, uid, d.settings || {}); return;
    case 'product.add': saveProduct(app, uid, d, d.aliases || ''); return;
    case 'kv.put': {
      const k = String(d.k), v = String(d.v), t = +d.t || Date.now();
      const r = one(app, 'kv', uid, 'k = {:k}', { k });
      if (!r) { newRec(app, 'kv', uid, { k, v, t }); return; }
      if (r.getFloat('t') > t) return;                 // на сервере уже новее
      r.set('v', v); r.set('t', t); app.save(r); return;
    }
    case 'kv.del': { const r = one(app, 'kv', uid, 'k = {:k}', { k: String(d.k) }); if (r) app.delete(r); return; }
  }
}
function push(app, uid, b) {
  let applied = 0;
  app.runInTransaction(tx => {
    (b.ops || []).forEach(op => {
      if (!op || !op.uid) return;
      if (one(tx, 'ops', uid, 'uid = {:x}', { x: String(op.uid) })) return;
      applyOp(tx, uid, op);
      newRec(tx, 'ops', uid, { uid: String(op.uid) });
      applied++;
    });
  });
  // старые отметки об операциях больше не нужны
  if (Math.random() < 0.05) {
    try { all(app, 'ops', uid, 'created < {:c}', { c: shiftDate(today(), -60) + ' 00:00:00' }).forEach(r => app.delete(r)); } catch (e) {}
  }
  return Object.assign({ applied }, pull(app, uid, b));
}

function setWeight(app, uid, date, kg) {
  if (!kg) return;
  const r = one(app, 'weights', uid, 'date = {:d}', { d: date });
  if (r) { r.set('kg', kg); app.save(r); } else newRec(app, 'weights', uid, { date, kg });
}
function addWater(app, uid, date, ml) {
  const r = one(app, 'water', uid, 'date = {:d}', { d: date });
  if (r) { const v = Math.max(0, r.getFloat('ml') + ml); r.set('ml', v); app.save(r); return v; }
  const v = Math.max(0, ml); newRec(app, 'water', uid, { date, ml: v }); return v;
}

/* ---------- Open Food Facts ---------- */
function sameWord(a, b) {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  if (min < 3) return false;
  let i = 0; while (i < min && a[i] === b[i]) i++;
  return i >= Math.max(3, Math.max(a.length, b.length) - 2) || (i >= min - 1 && i >= 3 && Math.abs(a.length - b.length) <= 2);
}
function offSearch(q) {
  q = String(q || '').trim();
  if (!q) return null;
  const fields = 'code,product_name,product_name_ru,brands,nutriments';
  let list = [];
  try {
    const url = /^\d{8,14}$/.test(q)
      ? 'https://world.openfoodfacts.org/api/v2/product/' + q + '.json?fields=' + fields
      : 'https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1&page_size=20&lc=ru&cc=ru&fields=' + fields + '&search_terms=' + encodeURIComponent(q);
    const res = $http.send({ url, method: 'GET', headers: { 'User-Agent': 'DnevnikGeroya/3.0 (fitness diary)' }, timeout: 12 });
    const o = res.json || {};
    list = o.product ? [o.product] : (o.products || []);
  } catch (e) { return null; }
  const qt = norm(q).split(' ').filter(w => w.length > 1);
  let best = null, bestScore = 0;
  list.forEach(p => {
    const n = p.nutriments || {};
    const kcal = num(n['energy-kcal_100g']) != null ? num(n['energy-kcal_100g']) : (num(n['energy_100g']) != null ? num(n['energy_100g']) / 4.184 : null);
    if (kcal == null || num(n.proteins_100g) == null || num(n.fat_100g) == null || num(n.carbohydrates_100g) == null) return;
    const title = String(p.product_name_ru || p.product_name || '').trim();
    if (!title) return;
    const hay = norm(title + ' ' + (p.brands || '')).split(' ');
    let hit = 0; qt.forEach(a => { if (hay.some(b2 => sameWord(a, b2))) hit++; });
    const score = /^\d+$/.test(q) ? 1 : hit / Math.max(1, qt.length);
    if (score > bestScore) { bestScore = score; best = { p, kcal, title }; }
  });
  if (!best || bestScore < 0.6) return null;
  const n = best.p.nutriments, brands = String(best.p.brands || '').split(',').map(x => x.trim()).filter(Boolean);
  const hasBrand = brands.some(x => norm(best.title).indexOf(norm(x)) >= 0);
  return { name: (brands.length && !hasBrand ? brands[0] + ' ' : '') + best.title, kcal: Math.round(best.kcal), p: r1(num(n.proteins_100g)), f: r1(num(n.fat_100g)), c: r1(num(n.carbohydrates_100g)), src: 'Open Food Facts' + (best.p.code ? ' ' + best.p.code : '') };
}
function lookup(app, uid, b) {
  const p = offSearch(String(b.q || ''));
  if (!p) return { found: null };
  if (b.save) saveProduct(app, uid, p, String(b.alias || b.q || ''));
  return { found: p, products: b.save ? compactProducts(products(app, uid)) : undefined };
}

/* ---------- разбор текста еды (как в командах) ---------- */
const NUMW = { 'один': 1, 'одна': 1, 'одно': 1, 'два': 2, 'две': 2, 'три': 3, 'четыре': 4, 'пять': 5, 'шесть': 6, 'семь': 7, 'восемь': 8, 'девять': 9, 'десять': 10, 'пол': 0.5, 'половина': 0.5, 'полтора': 1.5, 'полторы': 1.5 };
const MEAL_WORDS = { 'завтрак': 'Завтрак', 'обед': 'Обед', 'ужин': 'Ужин', 'перекус': 'Перекус', 'полдник': 'Перекус' };
const UNIT_RE = '(?:(шт|штук[аи]?|штуки|штука|г|гр|грамм(?:ов|а)?|кг|мл)\\.?)';
const DIG_RE = '(\\d+(?:[.,]\\d+)?)';
const WORD_RE = '(' + Object.keys(NUMW).join('|') + ')';

function item(raw, name, q, unit) {
  const qty = NUMW[q] != null ? NUMW[q] : num(q);
  let u = 'г';
  if (unit) { if (/^шт/.test(unit)) u = 'шт'; else if (unit === 'кг') u = 'кг'; else if (unit === 'мл') u = 'мл'; }
  else if (NUMW[q] != null) u = 'шт';
  return { raw, name: name.trim(), qty, unit: u, auto: !unit && NUMW[q] == null };
}
function parseFood(text) {
  let t = norm(text).replace(/[!?]+$/, '').replace(/\.$/, '');
  let meal = null;
  const m = t.match(/^(завтрак|обед|ужин|перекус|полдник)(?=[\s,:—-]|$)[\s,:—-]*/);
  if (m) { meal = MEAL_WORDS[m[1]]; t = t.slice(m[0].length); }
  const parts = t.split(/\s*(?:[;\n]|,(?!\d))\s*|\s+и\s+(?=\S+\s+\d)/).map(s => s.trim()).filter(Boolean);
  const items = parts.map(part => {
    let r = part.match(new RegExp('^(.*?\\D)\\s*' + DIG_RE + '\\s*' + UNIT_RE + '?$'));
    if (r) return item(part, r[1], r[2], r[3]);
    r = part.match(new RegExp('^(.+?)\\s+' + WORD_RE + '\\s*' + UNIT_RE + '?$'));
    if (r) return item(part, r[1], r[2], r[3]);
    r = part.match(new RegExp('^(?:' + DIG_RE + '|' + WORD_RE + ')\\s*' + UNIT_RE + '?\\s+(.+)$'));
    if (r) {
      const q = r[1] || r[2];
      const pcs = !r[3] && (r[2] || (Number.isInteger(num(q)) && num(q) <= 10));
      return item(part, r[4], q, r[3] || (pcs ? 'шт' : null));
    }
    return { raw: part, name: part, qty: null, unit: null };
  });
  return { meal, items };
}
function findProduct(q, prods) {
  const n = norm(q);
  const exact = prods.filter(p => p.keys.indexOf(n) >= 0);
  if (exact.length) return exact.find(p => p.def) || exact[0];
  const qt = n.split(' ');
  let best = null, bestScore = 0, bestKeyLen = 99;
  prods.forEach(p => p.keys.forEach(key => {
    const kt = key.split(' ');
    let hit = 0; qt.forEach(a => { if (kt.some(b => sameWord(a, b))) hit++; });
    if (!hit) return;
    const score = 0.8 * hit / qt.length + 0.2 * hit / kt.length;
    const better = score > bestScore + 1e-9 || (Math.abs(score - bestScore) < 1e-9 && ((p.def && !(best && best.def)) || (!!p.def === !!(best && best.def) && kt.length < bestKeyLen)));
    if (better) { best = p; bestScore = score; bestKeyLen = kt.length; }
  }));
  return bestScore >= 0.75 ? best : null;
}
function resolveItems(app, uid, text) {
  const prods = products(app, uid);
  const parsed = parseFood(text), out = [], errors = [];
  parsed.items.forEach(it => {
    if (!it.qty) { errors.push('Не понял количество: «' + it.raw + '» — нужно, например, «' + it.name + ' 100»'); return; }
    let p = findProduct(it.name, prods), src = '';
    if (!p) {
      const found = offSearch(it.name);
      if (found) {
        saveProduct(app, uid, found, it.name);
        p = { name: found.name, kcal: found.kcal, p: found.p, f: found.f, c: found.c, piece: null };
        prods.push(Object.assign({ keys: [norm(found.name), norm(it.name)] }, p));
        src = 'Open Food Facts';
      }
    }
    if (!p) { errors.push('Не нашёл «' + it.name + '» ни в базе, ни в Open Food Facts — добавьте продукт в приложении'); return; }
    let g = it.qty;
    if (it.auto && p.piece && it.qty <= 10 && Number.isInteger(it.qty)) it.unit = 'шт';
    if (it.unit === 'шт') { if (!p.piece) { errors.push('У «' + p.name + '» не задан вес 1 шт — напишите в граммах'); return; } g = it.qty * p.piece; }
    else if (it.unit === 'кг') g = it.qty * 1000;
    out.push({ p, g, raw: it.raw, pcs: it.unit === 'шт' ? it.qty : null, src });
  });
  return { meal: parsed.meal, items: out, errors };
}

/* ---------- Команды iPhone ---------- */
function keyUser(app, key) {
  key = String(key || '').trim();
  if (key.length < 16) return null;
  try { return app.findFirstRecordByFilter('api_keys', 'key = {:k}', { k: key }).getString('user'); } catch (e) { return null; }
}
function dayTotals(app, uid, date) {
  return sum(all(app, 'food', uid, 'date = {:d}', { d: date }).map(foodRow));
}
function shortcut(app, uid, b) {
  const type = String(b.type || '').trim().toLowerCase();
  const text = String(b.text == null ? '' : b.text).trim();
  const date = today(), s = settings(app, uid);
  if (type === 'weight' || type === 'вес') {
    const kg = num(text);
    if (!kg || kg < 20 || kg > 400) return 'Не понял вес. Введите число, например 82,4';
    const prev = all(app, 'weights', uid, 'date < {:d}', { d: date }, '-date')[0];
    setWeight(app, uid, date, kg);
    return 'Вес ' + fmt(kg) + ' кг записан' + (prev ? ' · ' + signed(kg - prev.getFloat('kg')) + ' к ' + shortDate(prev.getString('date')) : '');
  }
  if (type === 'water' || type === 'вода') {
    const ml = num(text) || s.glass;
    const total = addWater(app, uid, date, ml);
    return 'Вода +' + ml + ' мл · всего ' + fmt(total / 1000) + ' из ' + fmt(s.water / 1000) + ' л';
  }
  if (!text) return 'Пусто. Напишите, например: завтрак овсянка 50';
  const t = norm(text);
  if (/^(итог|итоги|что осталось|сколько осталось|остаток)$/.test(t)) {
    const tt = dayTotals(app, uid, date), left = s.kcal - Math.round(tt.kcal);
    const w = one(app, 'water', uid, 'date = {:d}', { d: date });
    return ['Итог за ' + shortDate(date) + ': ' + Math.round(tt.kcal) + ' / ' + s.kcal + ' ккал' + (left >= 0 ? ' · осталось ' + left : ' · сверх ' + (-left)),
      'Б ' + Math.round(tt.p) + '/' + s.p + ' · Ж ' + Math.round(tt.f) + '/' + s.f + ' · У ' + Math.round(tt.c) + '/' + s.c,
      'Вода ' + fmt((w ? w.getFloat('ml') : 0) / 1000) + ' из ' + fmt(s.water / 1000) + ' л'].join('\n');
  }
  if (/^(удали|удалить|отмени|отменить)( последнее| последнюю| последний)?( запись)?$/.test(t)) {
    const last = all(app, 'food', uid, 'date = {:d}', { d: date }, '-created')[0];
    if (!last) return 'Сегодня ещё нет записей';
    const name = last.getString('name'), g = last.getFloat('grams'), k = last.getFloat('kcal');
    app.delete(last);
    return 'Удалил: ' + name + ' ' + fmt(g) + ' г — ' + k + ' ккал\nСегодня ' + Math.round(dayTotals(app, uid, date).kcal) + ' из ' + s.kcal;
  }
  const mc = t.match(/^(сколько в|сколько|посчитай|хочу съесть|хочу)\s+(.+)$/);
  if (mc) {
    const r = resolveItems(app, uid, mc[2]), lines = [];
    const items = r.items.map(x => { const g = r1(x.g), k = g / 100; return { name: x.p.name, grams: g, pcs: x.pcs, kcal: Math.round(x.p.kcal * k), p: r1(x.p.p * k), f: r1(x.p.f * k), c: r1(x.p.c * k), src: x.src }; });
    items.forEach(e => lines.push(e.name + ' ' + fmtGrams(e) + ' — ' + e.kcal + ' ккал · Б ' + fmt(e.p) + ' · Ж ' + fmt(e.f) + ' · У ' + fmt(e.c)));
    if (items.length > 1) lines.push('Вместе ' + Math.round(sum(items).kcal) + ' ккал');
    if (items.length) lines.push('Не записано. Если съесть — останется ' + (s.kcal - Math.round(dayTotals(app, uid, date).kcal) - Math.round(sum(items).kcal)) + ' ккал');
    r.errors.forEach(x => lines.push(x));
    return lines.join('\n') || 'Не понял, что посчитать';
  }
  // запись еды
  const r = resolveItems(app, uid, text);
  const meal = r.meal || mealByTime();
  const added = r.items.map(x => {
    const g = r1(x.g), k = g / 100;
    const e = { id: rid(), date, time: nowHM(), meal, name: x.p.name, grams: g, kcal: Math.round(x.p.kcal * k), p: r1(x.p.p * k), f: r1(x.p.f * k), c: r1(x.p.c * k), pcs: x.pcs };
    newRec(app, 'food', uid, { eid: e.id, date, time: e.time, meal, name: e.name, grams: g, kcal: e.kcal, p: e.p, f: e.f, c: e.c, raw: x.raw, src: 'iPhone' + (x.src ? ' · ' + x.src : '') });
    return e;
  });
  const lines = [];
  added.forEach(e => lines.push(e.meal + ' · ' + e.name + ' ' + fmtGrams(e) + ' — ' + e.kcal + ' ккал'));
  if (added.length) {
    const tt = sum(added); lines.push('Б - ' + Math.round(tt.p) + ' гр. | Ж - ' + Math.round(tt.f) + ' гр. | У - ' + Math.round(tt.c) + ' гр.');
    const day = Math.round(dayTotals(app, uid, date).kcal), left = s.kcal - day;
    lines.push('Сегодня ' + day + ' из ' + s.kcal + (left >= 0 ? ' · осталось ' + left : ' · сверх нормы ' + (-left)));
  }
  r.errors.forEach(x => lines.push(x));
  return lines.join('\n') || 'Ничего не записал';
}

/* ---------- личный ключ для Команд ---------- */
function getKey(app, uid, rotate) {
  let r = one(app, 'api_keys', uid, 'id != ""');
  if (r && !rotate) return r.getString('key');
  if (r) app.delete(r);
  const key = $security.randomStringWithAlphabet(32, 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  newRec(app, 'api_keys', uid, { key, name: 'Команды iPhone' });
  return key;
}

module.exports = { pull, push, lookup, shortcut, keyUser, getKey, parseFood, today };
