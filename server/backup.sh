#!/usr/bin/env bash
# Ночная копия базы «Дневника» (без остановки сервиса), храним 14 дней.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
STAMP=$(date +%F)
mkdir -p "$DIR/backups"
for f in data.db auxiliary.db; do
  [ -f "$DIR/pb_data/$f" ] && sqlite3 "$DIR/pb_data/$f" ".backup '$DIR/backups/$STAMP-$f'" 2>/dev/null || cp "$DIR/pb_data/$f" "$DIR/backups/$STAMP-$f"
done
gzip -f "$DIR"/backups/$STAMP-*.db
find "$DIR/backups" -name '*.gz' -mtime +14 -delete
