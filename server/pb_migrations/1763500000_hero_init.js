/// <reference path="../pb_data/types.d.ts" />
// «Дневник героя»: пользователи по логину и паролю, у каждого свои данные.
migrate((app) => {
  // ---- пользователи: вход по логину (без почты и телефона) ----
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new TextField({ name: "username", required: true, min: 3, max: 32, pattern: "^[a-z0-9_.-]+$" }));
  users.indexes.push("CREATE UNIQUE INDEX idx_users_username ON users (username)");
  users.fields.getByName("email").required = false;
  users.passwordAuth.identityFields = ["username"];
  users.createRule = "";                                   // регистрация открыта
  users.listRule = "id = @request.auth.id";
  users.viewRule = "id = @request.auth.id";
  users.updateRule = "id = @request.auth.id";
  users.deleteRule = "id = @request.auth.id";              // «Удалить аккаунт» — вместе со всеми данными
  users.authToken.duration = 60 * 60 * 24 * 180;           // вход держится полгода
  app.save(users);

  const OWN = "user = @request.auth.id";
  const own = (name, fields, indexes) => {
    const c = new Collection({
      type: "base", name,
      listRule: OWN, viewRule: OWN, createRule: "@request.auth.id != '' && " + OWN, updateRule: OWN, deleteRule: OWN,
      fields: [
        { name: "user", type: "relation", collectionId: users.id, cascadeDelete: true, required: true, maxSelect: 1 },
        ...fields,
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes,
    });
    app.save(c);
  };
  const T = (name, o = {}) => Object.assign({ name, type: "text" }, o);
  const N = (name, o = {}) => Object.assign({ name, type: "number" }, o);

  // настройки и профиль (одна запись на человека)
  own("settings", [{ name: "data", type: "json", maxSize: 200000 }], ["CREATE UNIQUE INDEX idx_settings_user ON settings (user)"]);
  // еда
  own("food", [T("eid", { required: true }), T("date", { required: true }), T("time"), T("meal"), T("name"), N("grams"), N("kcal"), N("p"), N("f"), N("c"), T("raw"), T("src")],
    ["CREATE UNIQUE INDEX idx_food_user_eid ON food (user, eid)", "CREATE INDEX idx_food_user_date ON food (user, date)"]);
  // вода и вес по дням
  own("water", [T("date", { required: true }), N("ml")], ["CREATE UNIQUE INDEX idx_water_user_date ON water (user, date)"]);
  own("weights", [T("date", { required: true }), N("kg")], ["CREATE UNIQUE INDEX idx_weights_user_date ON weights (user, date)"]);
  // личные продукты
  own("products", [T("name", { required: true }), T("aliases"), T("state"), N("kcal"), N("p"), N("f"), N("c"), N("piece"), { name: "def", type: "bool" }, T("src")],
    ["CREATE INDEX idx_products_user ON products (user)"]);
  // тренировки, программы, отметки по месяцам — «ключ → значение», как в приложении
  own("kv", [T("k", { required: true }), T("v", { max: 200000 }), N("t")],
    ["CREATE UNIQUE INDEX idx_kv_user_k ON kv (user, k)", "CREATE INDEX idx_kv_user_t ON kv (user, t)"]);
  // защита от повторной отправки одной и той же операции
  own("ops", [T("uid", { required: true })], ["CREATE UNIQUE INDEX idx_ops_user_uid ON ops (user, uid)"]);
  // личные ключи для Команд iPhone
  own("api_keys", [T("key", { required: true }), T("name")], ["CREATE UNIQUE INDEX idx_api_keys_key ON api_keys (key)"]);
  const keys = app.findCollectionByNameOrId("api_keys");
  keys.listRule = keys.viewRule = OWN; keys.createRule = keys.updateRule = null; keys.deleteRule = OWN;   // ключи выдаёт только сервер
  app.save(keys);
  const ops = app.findCollectionByNameOrId("ops");
  ops.listRule = ops.viewRule = ops.createRule = ops.updateRule = ops.deleteRule = null;
  app.save(ops);

  // ---- общий справочник продуктов (читают все вошедшие, меняет только администратор) ----
  const g = new Collection({
    type: "base", name: "products_global",
    listRule: "@request.auth.id != ''", viewRule: "@request.auth.id != ''", createRule: null, updateRule: null, deleteRule: null,
    fields: [T("name", { required: true }), T("aliases"), T("state"), N("kcal"), N("p"), N("f"), N("c"), N("piece"), { name: "def", type: "bool" }, T("src")],
    indexes: ["CREATE UNIQUE INDEX idx_pg_name ON products_global (name)"],
  });
  app.save(g);

  // ---- защита от перебора паролей и спама регистрациями ----
  const s = app.settings();
  s.meta.appName = "Дневник героя";
  s.rateLimits.enabled = true;
  s.rateLimits.rules = [
    { label: "*:auth", maxRequests: 10, duration: 60 },
    { label: "POST /api/collections/users/records", maxRequests: 6, duration: 600 },
    { label: "/api/hero/shortcut", maxRequests: 30, duration: 60 },
    { label: "/api/", maxRequests: 120, duration: 10 },
  ];
  app.save(s);
}, (app) => {
  ["food", "water", "weights", "products", "kv", "ops", "api_keys", "settings", "products_global"].forEach(n => {
    try { app.delete(app.findCollectionByNameOrId(n)); } catch (e) {}
  });
});
