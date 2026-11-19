#!/usr/bin/env bash
# Установка сервера «Дневник героя» (PocketBase) на ваш сервер.
# Запуск:  sudo bash install.sh api.ваш-домен.ru  admin@почта.ru
# Ничего из уже работающих сайтов не трогает: отдельная папка, отдельный пользователь, отдельный порт.
set -euo pipefail
DOMAIN="${1:?Укажите поддомен, например: sudo bash install.sh api.mysite.ru admin@mysite.ru}"
EMAIL="${2:?Укажите почту администратора (для входа в админку и сертификата)}"
PB_VER="0.28.4"
PORT="8090"
DIR="/opt/hero"
APP_ORIGIN="${APP_ORIGIN:-https://logvan.github.io}"   # откуда открывается приложение
SRC="$(cd "$(dirname "$0")" && pwd)"

echo "== 0/6 Нужные программы"
for p in curl unzip rsync sqlite3; do command -v $p >/dev/null || NEED="$NEED $p"; done
[ -n "${NEED:-}" ] && { command -v apt-get >/dev/null && apt-get install -y $NEED || { echo "Установите:$NEED"; exit 1; }; }

echo "== 1/6 Пользователь и папка"
id hero >/dev/null 2>&1 || useradd --system --home "$DIR" --shell /usr/sbin/nologin hero
mkdir -p "$DIR" "$DIR/backups"

echo "== 2/6 PocketBase $PB_VER"
ARCH=$(uname -m); case "$ARCH" in x86_64) A=amd64;; aarch64|arm64) A=arm64;; *) echo "Неизвестная архитектура $ARCH"; exit 1;; esac
if [ ! -x "$DIR/pocketbase" ] || ! "$DIR/pocketbase" --version | grep -q "$PB_VER"; then
  TMP=$(mktemp -d)
  curl -fsSL -o "$TMP/pb.zip" "https://github.com/pocketbase/pocketbase/releases/download/v$PB_VER/pocketbase_${PB_VER}_linux_${A}.zip"
  (cd "$TMP" && unzip -oq pb.zip pocketbase) && install -m 755 "$TMP/pocketbase" "$DIR/pocketbase" && rm -rf "$TMP"
fi
rsync -a --delete "$SRC/pb_migrations/" "$DIR/pb_migrations/"
rsync -a --delete "$SRC/pb_hooks/" "$DIR/pb_hooks/"
install -m 755 "$SRC/backup.sh" "$DIR/backup.sh"
chown -R hero:hero "$DIR"

echo "== 3/6 База и администратор"
sudo -u hero "$DIR/pocketbase" migrate up --dir="$DIR/pb_data" --migrationsDir="$DIR/pb_migrations"
if [ ! -f "$DIR/.admin_created" ]; then
  ADMIN_PASS=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 20)
  sudo -u hero "$DIR/pocketbase" superuser upsert "$EMAIL" "$ADMIN_PASS" --dir="$DIR/pb_data"
  echo "$EMAIL / $ADMIN_PASS" > "$DIR/.admin_created"; chmod 600 "$DIR/.admin_created"; chown hero:hero "$DIR/.admin_created"
fi

echo "== 4/6 Автозапуск (systemd)"
sed -e "s|__DIR__|$DIR|g" -e "s|__PORT__|$PORT|g" -e "s|__ORIGIN__|$APP_ORIGIN|g" "$SRC/hero.service" > /etc/systemd/system/hero.service
systemctl daemon-reload && systemctl enable --now hero && sleep 2 && systemctl restart hero

echo "== 5/6 Nginx для $DOMAIN"
if command -v nginx >/dev/null; then
  CONF=/etc/nginx/sites-available/hero.conf; [ -d /etc/nginx/sites-available ] || CONF=/etc/nginx/conf.d/hero.conf
  sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__PORT__|$PORT|g" "$SRC/nginx-hero.conf" > "$CONF"
  [ -d /etc/nginx/sites-enabled ] && ln -sf "$CONF" /etc/nginx/sites-enabled/hero.conf
  nginx -t && systemctl reload nginx
  if command -v certbot >/dev/null; then certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos -n --redirect || echo "!! Сертификат не получен — проверьте, что $DOMAIN указывает на этот сервер, и запустите: certbot --nginx -d $DOMAIN"
  else echo "!! certbot не найден. Установите: apt install certbot python3-certbot-nginx — и запустите: certbot --nginx -d $DOMAIN"; fi
else
  echo "!! nginx не найден — пришлите вывод, подскажу настройку под ваш веб-сервер"
fi

echo "== 6/6 Ночные копии базы (03:30, храним 14 дней)"
( crontab -u hero -l 2>/dev/null | grep -v backup.sh; echo "30 3 * * * $DIR/backup.sh >/dev/null 2>&1" ) | crontab -u hero -

echo
echo "Готово. Проверка: curl https://$DOMAIN/api/hero/health"
echo "Админка: https://$DOMAIN/_/  — логин и пароль: sudo cat $DIR/.admin_created"
