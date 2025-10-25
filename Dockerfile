# ---- Builder ----
FROM node:20-bookworm-slim AS build
RUN corepack enable
WORKDIR /app

# nur für native Builds nötig
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
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

COPY --from=build /app ./
EXPOSE 3000
CMD ["pnpm","start"]
