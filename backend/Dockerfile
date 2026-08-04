# syntax=docker/dockerfile:1

# --- build stage: compile TypeScript, needs devDependencies (typescript, tsx, @types/node) ---
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- runtime stage: production deps only, compiled dist/ copied in ---
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

# SQLite DB, downloaded media, and uploaded-widget files all live under here — mount
# this as a volume (see docker-compose.yml) so they survive container recreation.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 4000

# node:sqlite is still an experimental Node API (see storage/db/index.ts) — matches
# the --experimental-sqlite flag already used by `npm start` in package.json.
CMD ["node", "--experimental-sqlite", "dist/index.js"]
