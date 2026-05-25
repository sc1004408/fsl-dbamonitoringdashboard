FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/frontend/package.json ./apps/frontend/package.json
# Clean install: remove node_modules and lock file if present
RUN rm -rf node_modules package-lock.json && npm install
COPY . .
RUN npm run build -w apps/frontend

FROM nginx:1.27-alpine
COPY --from=builder /app/apps/frontend/dist /usr/share/nginx/html
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
