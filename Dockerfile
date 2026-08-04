FROM oven/bun:1.3.14 AS install

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM install AS build

COPY . .
RUN bun run build

FROM oven/bun:1.3.14 AS release

ARG GIT_REVISION
ENV HOST=0.0.0.0 \
    PORT=3001 \
    STATIC_ROOT=/app/dist/client \
    APP_REVISION=${GIT_REVISION} \
    AI_SDK_DEVTOOLS=false

LABEL org.opencontainers.image.source="https://github.com/paulmccallick/gig-finder" \
      org.opencontainers.image.revision="${GIT_REVISION}"

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/data/migrations ./dist/server/migrations

USER bun
EXPOSE 3001/tcp
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
  CMD ["bun", "-e", "const r=await fetch('http://127.0.0.1:3001/healthz');if(!r.ok)process.exit(1)"]

CMD ["bun", "dist/server/server.js"]
