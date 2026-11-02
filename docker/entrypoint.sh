#!/bin/sh
# Container start: migrate, seed an empty database when SEED_DEMO_DATA=true, then hand
# PID 1 over to the CMD so it receives SIGTERM directly.
set -eu

echo "entrypoint: applying database migrations"
./node_modules/.bin/prisma migrate deploy

# The seed is a no-op when SEED_DEMO_DATA=false or the database already has data.
node dist/prisma/seed.js

exec "$@"
