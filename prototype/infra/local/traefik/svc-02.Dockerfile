FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/svc-02-ride-request/package.json apps/svc-02-ride-request/tsconfig.json ./apps/svc-02-ride-request/
RUN npm ci --include-workspace-root --workspace @uber-prototype/svc-02-ride-request

COPY apps/svc-02-ride-request/src ./apps/svc-02-ride-request/src
RUN npm run build --workspace @uber-prototype/svc-02-ride-request

USER node
CMD ["node", "apps/svc-02-ride-request/dist/server.js"]
