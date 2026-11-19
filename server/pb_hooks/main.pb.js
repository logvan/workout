/// <reference path="../pb_data/types.d.ts" />
// «Дневник героя» — адреса для приложения и Команд iPhone.
// Каждый обработчик подключает общую логику сам (так требует PocketBase).

// проверка, что сервер жив
routerAdd("GET", "/api/hero/health", (e) => e.json(200, { ok: true, app: "dnevnik-geroya", ver: 3, today: require(`${__hooks}/hero_lib.js`).today() }));

// всё, что нужно приложению при синхронизации
routerAdd("POST", "/api/hero/pull", (e) => {
  const L = require(`${__hooks}/hero_lib.js`);
  const b = e.requestInfo().body || {};
  return e.json(200, Object.assign({ ok: true }, L.pull(e.app, e.auth.id, b)));
}, $apis.requireAuth("users"));

// очередь изменений с телефона (в том числе накопленная без интернета)
routerAdd("POST", "/api/hero/push", (e) => {
  const L = require(`${__hooks}/hero_lib.js`);
  const b = e.requestInfo().body || {};
  if ((b.ops || []).length > 500) return e.json(400, { ok: false, error: "Слишком много изменений за раз" });
  return e.json(200, Object.assign({ ok: true }, L.push(e.app, e.auth.id, b)));
}, $apis.requireAuth("users"));

// поиск продукта в Open Food Facts
routerAdd("POST", "/api/hero/lookup", (e) => {
  const L = require(`${__hooks}/hero_lib.js`);
  const b = e.requestInfo().body || {};
  return e.json(200, Object.assign({ ok: true }, L.lookup(e.app, e.auth.id, b)));
}, $apis.requireAuth("users"));

// личный ключ для Команд iPhone: получить (или выпустить новый, если rotate)
routerAdd("POST", "/api/hero/key", (e) => {
  const L = require(`${__hooks}/hero_lib.js`);
  const b = e.requestInfo().body || {};
  return e.json(200, { ok: true, key: L.getKey(e.app, e.auth.id, !!b.rotate) });
}, $apis.requireAuth("users"));

// Команды iPhone: { secret: <личный ключ>, type: "food" | "weight" | "water", text: "обед гречка 80" } → текст ответа
routerAdd("POST", "/api/hero/shortcut", (e) => {
  const L = require(`${__hooks}/hero_lib.js`);
  const b = e.requestInfo().body || {};
  const uid = L.keyUser(e.app, b.secret || b.key);
  if (!uid) return e.string(200, "Неверный ключ — скопируйте его заново в приложении: Настройки → Команды iPhone");
  try { return e.string(200, L.shortcut(e.app, uid, b)); }
  catch (err) { return e.string(200, "Ошибка: " + err); }
});

// Для администратора: сделать продукты пользователя общими для всех (например, вашу базу).
// Вызов: POST /api/hero/admin/promote { "username": "ivan" } с токеном администратора.
routerAdd("POST", "/api/hero/admin/promote", (e) => {
  const b = e.requestInfo().body || {};
  const u = e.app.findFirstRecordByFilter("users", "username = {:u}", { u: String(b.username || "") });
  const col = e.app.findCollectionByNameOrId("products_global");
  let added = 0;
  e.app.findRecordsByFilter("products", "user = {:u}", "", 0, 0, { u: u.id }).forEach(p => {
    try { e.app.findFirstRecordByFilter("products_global", "name = {:n}", { n: p.getString("name") }); return; } catch (err) {}
    const r = new Record(col);
    ["name", "aliases", "state", "kcal", "p", "f", "c", "piece", "def", "src"].forEach(k => r.set(k, p.get(k)));
    e.app.save(r); added++;
  });
  return e.json(200, { ok: true, added });
}, $apis.requireSuperuserAuth());
