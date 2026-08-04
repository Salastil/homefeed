# syntax=docker/dockerfile:1

# --- build stage ---
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Baked into both the client and server bundles at build time (Vite convention —
# see src/lib/config.ts's getBackendUrl()), not read fresh at container start.
# Must resolve to the backend from every context that calls it: the visitor's
# browser, AND this container's own Node process for the server-rendered (SSR)
# fetches +layout.ts makes on a page's very first load. See docker-compose.yml,
# which runs this container sharing the backend container's network namespace so
# a single http://localhost:<port> value is genuinely correct for both.
ARG VITE_BACKEND_URL=http://localhost:4000
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL

RUN npm run build

# --- runtime stage ---
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# adapter-node bundles every server-side dependency into build/ — no node_modules
# needed at runtime (frontend/package.json has no runtime "dependencies" at all).
COPY --from=build /app/build ./build

EXPOSE 3000

CMD ["node", "build/index.js"]
