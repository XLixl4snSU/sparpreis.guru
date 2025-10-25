# ---- Builder ----
FROM node:20-bookworm-slim AS build
RUN corepack enable
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --unsafe-perm

COPY . .
RUN pnpm build

# ---- Runtime ----
FROM node:20-bookworm-slim
RUN corepack enable
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# Toolchain für Rebuild des Native-Addons
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app ./

# **WICHTIG**: Binding in der Runtime-Stage (neu) bauen/validieren
ENV npm_config_build_from_source=true
RUN pnpm rebuild better-sqlite3 --recursive \
 && node -e "require('better-sqlite3') && console.log('better-sqlite3 OK')"

EXPOSE 3000
CMD ["pnpm","start"]
