ARG AFTERFRAME_SERVICE=web
FROM node:22-bookworm-slim AS web-build
WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json apps/web/
RUN npm ci --prefix apps/web
COPY apps/web/ apps/web/
COPY afterframe/public/art/ afterframe/public/art/
RUN npm run build --prefix apps/web

FROM node:22-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production AFTERFRAME_HOST=::
COPY apps/api/http-settings.mjs apps/api/http-settings.mjs
COPY apps/web/server.mjs apps/web/server.mjs
COPY --from=web-build /app/apps/web/dist/ apps/web/dist/
USER node
CMD ["node", "apps/web/server.mjs"]

FROM node:22-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production AFTERFRAME_HOST=::
COPY afterframe/package.json afterframe/package-lock.json afterframe/
RUN npm ci --omit=dev --prefix afterframe
COPY --chown=node:node afterframe/ afterframe/
COPY apps/api/ apps/api/
USER node
CMD ["node", "--use-system-ca", "apps/api/server.mjs"]

FROM ${AFTERFRAME_SERVICE} AS runtime
