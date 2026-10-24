#!/bin/sh
if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is not set" >&2
  exit 1
fi

echo "Applying database migrations"
n=0
until (cd /app/migrate && node node_modules/prisma/build/index.js migrate deploy); do
  n=$((n + 1))
  if [ "$n" -ge 5 ]; then
    echo "Migrations failed 5 times; starting the server anyway." >&2
    break
  fi
  echo "Migration attempt $n failed; retrying in 5s" >&2
  sleep 5
done

exec node /app/apps/web/server.js
