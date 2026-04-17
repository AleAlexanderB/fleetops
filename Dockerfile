# ══════════════════════════════════════════════════════════════════
# FleetOPS — Dockerfile multi-stage
#
# Etapa 1: Build del frontend React + Vite
# Etapa 2: Imagen final con Node 20 Alpine + frontend compilado
# ══════════════════════════════════════════════════════════════════

# ── Etapa 1: Build del frontend ───────────────────────────────────
FROM node:20-alpine AS build-client

RUN apk add --no-cache openssl

WORKDIR /app/client

COPY client/package*.json ./
RUN npm install

# VITE_API_URL se pasa como build-arg desde docker-compose
ARG VITE_API_URL=http://localhost:8077
ARG VITE_API_KEY=
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_API_KEY=$VITE_API_KEY

COPY client/ .
RUN npm run build
# resultado → /app/client/dist

# ── Etapa 2: Imagen final ─────────────────────────────────────────
FROM node:20-alpine AS final

RUN apk add --no-cache openssl wget

WORKDIR /app

# Dependencias del servidor (solo producción)
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

# Código del servidor
COPY server/ ./server/

# Build del frontend (desde etapa anterior)
# vite.config.ts tiene outDir: '../public' → output en /app/public
COPY --from=build-client /app/public ./public

# Carpeta para datos persistentes (divisiones.json)
RUN mkdir -p /app/data

EXPOSE 8077

ENV NODE_ENV=production
ENV PORT=8077
ENV TZ=America/Argentina/Buenos_Aires

CMD ["node", "server/src/server.js"]
