FROM node:24-bookworm-slim AS base

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps

RUN npm install --global corepack@latest && corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
RUN corepack install && pnpm install --frozen-lockfile

FROM base AS builder

RUN npm install --global corepack@latest && corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build
RUN rm -f public/direct-connections.db

FROM base AS runner

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN mkdir -p data && chown node:node data

COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node

EXPOSE 3000
CMD ["node", "server.js"]
