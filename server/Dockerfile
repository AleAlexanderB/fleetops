# ══════════════════════════════════════════════════════════════════
# FleetOPS — Dockerfile multi-stage
# Etapa 1: Build del frontend React + Vite
# Etapa 2: Imagen final con Node.js + frontend compilado
#
# Stack de versiones estables:
#   Node.js 20 LTS · React 18 · Vite 5 LTS · Tailwind v3 · MySQL 8.0
# ══════════════════════════════════════════════════════════════════

# ── Etapa 1: Build del frontend ───────────────────────────────────
FROM node:20-alpine AS build-client

RUN apk add --no-cache openssl

WORKDIR /app/client

# Copiar solo package.json (sin lock) para que npm install resuelva
# versiones frescas según los rangos definidos en package.json
COPY client/package.json ./
RUN npm install

# VITE_API_URL se pasa como ARG en tiempo de build
# Ejemplo: docker build --build-arg VITE_API_URL=http://192.168.1.100:8077 .
ARG VITE_API_URL=http://localhost:8077
ENV VITE_API_URL=$VITE_API_URL

ARG VITE_API_KEY=
ENV VITE_API_KEY=$VITE_API_KEY

# Copiar fuente y compilar
COPY client/ .
RUN npm run build
# El build queda en /app/client/dist

# ── Etapa 2: Imagen final ─────────────────────────────────────────
FROM node:20-alpine AS final

RUN apk add --no-cache openssl

WORKDIR /app

# Dependencias del servidor
COPY server/package.json ./server/
RUN cd server && npm install --omit=dev

# Código del servidor
COPY server/ ./server/

# Build del frontend (de la etapa anterior)
COPY --from=build-client /app/client/dist ./public

# Directorio para datos persistentes
RUN mkdir -p /app/data

EXPOSE 8077

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:8077/api/redgps/status || exit 1

ENV NODE_ENV=production
ENV PORT=8077

CMD ["node", "server/src/server.js"]
