FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json ./
COPY apps/collab/package.json ./apps/collab/
COPY packages/shared-types/package.json ./packages/shared-types/
RUN npm install --workspaces --if-present

FROM deps AS builder
COPY . .
RUN cd apps/collab && npx tsc

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/collab/dist ./dist
EXPOSE 3002
CMD ["node", "dist/index.js"]
