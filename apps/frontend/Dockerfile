FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json ./
COPY apps/frontend/package.json ./apps/frontend/
COPY packages/shared-types/package.json ./packages/shared-types/
RUN npm install --workspaces --if-present

FROM deps AS builder
COPY . .
# VITE_API_URL=/api → Axios routes through nginx proxy (no direct API port needed)
ENV VITE_API_URL=/api
RUN cd apps/frontend && npm run build

FROM nginx:alpine AS runner
COPY --from=builder /app/apps/frontend/dist /usr/share/nginx/html
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
