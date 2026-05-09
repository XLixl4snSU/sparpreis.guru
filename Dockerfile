FROM node:22-bookworm-slim

WORKDIR /app
RUN npm install --global corepack@latest && corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
RUN corepack install && pnpm install --frozen-lockfile

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm","start"]
