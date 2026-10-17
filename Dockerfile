FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Run build if TypeScript
RUN npm run build 2>/dev/null || true

# ---- Runtime stage ----
FROM node:20-alpine AS runtime

RUN apk add --no-cache curl

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./package.json

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "src/index.js"]
