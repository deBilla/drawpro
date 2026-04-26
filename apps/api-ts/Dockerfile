FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json ./
COPY apps/api-ts/package.json ./apps/api-ts/
COPY packages/shared-types/package.json ./packages/shared-types/
RUN npm install --workspaces --if-present

FROM deps AS builder
COPY . .
RUN cd apps/api-ts && npx prisma generate
RUN cd apps/api-ts && npx tsc

FROM node:20-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api-ts/dist ./dist
COPY --from=builder /app/apps/api-ts/prisma ./prisma
EXPOSE 3001
CMD ["node", "dist/index.js"]
