FROM oven/bun:1.3.14 AS build

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.3.14 AS runtime

ARG GIT_REVISION
ENV NODE_ENV=production \
    GIG_FINDER_RUNTIME=production \
    GIG_FINDER_STATIC_ROOT=/app/dist/client \
    GIG_FINDER_REVISION=${GIT_REVISION} \
    API_PORT=3001 \
    AI_SDK_DEVTOOLS=false

LABEL org.opencontainers.image.source="https://github.com/paulmccallick/gig-finder" \
      org.opencontainers.image.revision="${GIT_REVISION}"

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/data/drizzle ./dist/drizzle

USER bun
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
  CMD ["bun", "-e", "const r=await fetch('http://127.0.0.1:3001/healthz');if(!r.ok)process.exit(1)"]

CMD ["bun", "dist/server/production.js"]
