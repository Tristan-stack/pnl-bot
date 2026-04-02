FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY prisma/ ./prisma/
COPY prisma.config.ts ./

# Dummy DATABASE_URL for prisma generate (only generates client, doesn't connect)
ENV DATABASE_URL="file:./dummy.db"
RUN npx prisma generate

COPY src/ ./src/

RUN npx tsc

FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/generated/ ./generated/
COPY prisma/ ./prisma/
COPY prisma.config.ts ./

RUN mkdir -p /data/backgrounds

CMD ["node", "dist/src/index.js"]
