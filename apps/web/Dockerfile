# syntax=docker/dockerfile:1
# Production image for the Next.js web app.
# Build context is the repo root (monorepo), so NEXT_PUBLIC_* values are passed as build args.
FROM node:22-bookworm-slim

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY packages/types/package.json ./packages/types/
RUN pnpm install --frozen-lockfile

COPY . .

# NEXT_PUBLIC_* vars are inlined into the client bundle at build time.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN pnpm --filter @ai-developer-feed/web build

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

CMD ["pnpm", "--filter", "@ai-developer-feed/web", "start"]
