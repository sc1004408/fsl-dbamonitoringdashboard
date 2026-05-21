FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/backend/package.json ./apps/backend/package.json
RUN npm install
COPY . .
RUN npm run build -w apps/backend

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY apps/backend/package.json ./apps/backend/package.json
RUN npm install --omit=dev
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
EXPOSE 4000
CMD ["node", "apps/backend/dist/server.js"]
