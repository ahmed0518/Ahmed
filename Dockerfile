# Trax Production Status — any Docker host. Secrets are injected at runtime (never baked in).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
# Build-time only: the hostname whose root lands on /inventory (docker build --build-arg INVENTORY_HOST=inventory.traxnyc.com).
ARG INVENTORY_HOST=
ENV NEXT_TELEMETRY_DISABLED=1 \
    INVENTORY_HOST=$INVENTORY_HOST
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
