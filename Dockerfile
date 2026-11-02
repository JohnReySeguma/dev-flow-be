# syntax=docker/dockerfile:1

# Pinned so every build uses the same Node and Alpine; bump deliberately.
ARG NODE_IMAGE=node:22.23.4-alpine3.24

# ── base: shared settings ────────────────────────────────────────────
FROM ${NODE_IMAGE} AS base
WORKDIR /app
# No telemetry or update checks from npm packages during builds or at runtime.
ENV SCARF_ANALYTICS=false \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1

# ── build: compile TypeScript with dev dependencies ──────────────────
FROM base AS build
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# postinstall runs `prisma generate`, so the schema must be present first.
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ── deps: production dependencies only ───────────────────────────────
FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# Keeps the Prisma CLI and its schema engine for `migrate deploy` at startup.
RUN npm ci --omit=dev && npm cache clean --force

# ── runtime ──────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=4000
# Files stay owned by root and read-only for the app user.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json prisma.config.ts ./
COPY prisma ./prisma
COPY docker/entrypoint.sh docker/healthcheck.js ./docker/

USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "docker/healthcheck.js"]
ENTRYPOINT ["./docker/entrypoint.sh"]
CMD ["node", "--enable-source-maps", "dist/src/server.js"]
