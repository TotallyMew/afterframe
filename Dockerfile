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
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY afterframe/package.json afterframe/
RUN npm ci --omit=dev --workspace=@afterframe/api \
    && install -d -o node -g node /app/afterframe/data
COPY afterframe/public/ afterframe/public/
COPY apps/api/ apps/api/
USER node
CMD ["node", "--use-system-ca", "apps/api/server.mjs"]

FROM ${AFTERFRAME_SERVICE} AS runtime
