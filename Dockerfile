# TMEC Backend (NestJS + Prisma). Dùng bởi deploy/docker-compose.prod.yml.
# Giữ đủ devDependencies trong image để chạy được `npm run db:seed` (ts-node) ngay trong container.
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

ENV NODE_ENV=production
EXPOSE 3000

# Đồng bộ schema (theo quy ước nhóm: db push, không migrate) rồi chạy API.
# db push tự từ chối thay đổi làm mất dữ liệu, nên khởi động lại an toàn.
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/src/main"]
