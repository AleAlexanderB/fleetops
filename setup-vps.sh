#!/bin/bash
# ══════════════════════════════════════════════════════════════
# FleetOPS — Setup VPS (Ubuntu 24.04)
# Ejecutar como root en el servidor de DigitalOcean
# ══════════════════════════════════════════════════════════════

set -e
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   FleetOPS — Instalación en VPS          ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. Actualizar sistema ─────────────────────────────────────
echo "▶ Actualizando sistema..."
apt-get update -qq && apt-get upgrade -y -qq

# ── 2. Instalar Docker ────────────────────────────────────────
echo "▶ Instalando Docker..."
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

# ── 3. Instalar git ───────────────────────────────────────────
echo "▶ Instalando git..."
apt-get install -y -qq git

# ── 4. Clonar repositorio ─────────────────────────────────────
echo "▶ Clonando repositorio FleetOPS..."
mkdir -p /opt/fleetops
cd /opt/fleetops
git clone https://github.com/AleAlexanderB/fleetops.git .

# ── 5. Crear .env de producción ───────────────────────────────
echo "▶ Configurando variables de entorno..."
SERVER_IP=$(curl -s ifconfig.me)

cat > .env << EOF
# ══════════════════════════════════════════════════
# FleetOPS v9 — Variables de entorno (produccion)
# ══════════════════════════════════════════════════

# ── Multi-empresa RedGPS ─────────────────────────
EMPRESA_1_NOMBRE=Corralon el Mercado
EMPRESA_1_APIKEY=9780e7b24d1d5ed4f7ee70fedb839ccd
EMPRESA_1_USERNAME=apaza866@gmail.com
EMPRESA_1_PASSWORD=123456

EMPRESA_2_NOMBRE=VIAP
EMPRESA_2_APIKEY=af188c5f943efd3738665bb0591fa130
EMPRESA_2_USERNAME=uviap@gmail.com
EMPRESA_2_PASSWORD=123456

# ── RedGPS (legacy) ──────────────────────────────
REDGPS_APIKEY=9780e7b24d1d5ed4f7ee70fedb839ccd
REDGPS_USERNAME=apaza866@gmail.com
REDGPS_PASSWORD=123456
REDGPS_BASE_URL=http://api.service24gps.com/api/v1

# ── URLs ─────────────────────────────────────────
VITE_API_URL=http://${SERVER_IP}:8077

# ── Base de datos MySQL (Docker) ─────────────────
# IMPORTANTE: usar "db" como host (nombre del servicio Docker)
DATABASE_URL=mysql://fleetops:fleetops_2024@db:3306/fleetops

# ── Intervalos de polling ─────────────────────────
POLL_POSICIONES_MS=30000
POLL_ALERTAS_MS=300000
POLL_VEHICULOS_MS=3600000
POLL_GEOCERCAS_MS=3600000

# ── Servidor ─────────────────────────────────────
PORT=8077
NODE_ENV=production
CORS_ORIGIN=*

# ── Credenciales MySQL (Docker) ───────────────────
DB_ROOT_PASSWORD=fleetops_root_2024
DB_USER=fleetops
DB_PASSWORD=fleetops_2024

# ── Seguridad de API ─────────────────────────────
API_KEY=
EOF

echo "   .env creado con IP: ${SERVER_IP}"

# ── 6. Build y arranque ───────────────────────────────────────
echo "▶ Construyendo imagen Docker (puede tardar 3-5 minutos)..."
docker compose build

echo "▶ Iniciando servicios..."
docker compose up -d

# ── 7. Verificación ───────────────────────────────────────────
echo ""
echo "▶ Esperando que el servidor arranque (30 segundos)..."
sleep 30

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8077/api/auth/login \
  -X POST -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' 2>/dev/null || echo "000")

echo ""
echo "╔══════════════════════════════════════════╗"
if [ "$HTTP_CODE" = "200" ]; then
echo "║   ✅ FleetOPS corriendo correctamente!   ║"
else
echo "║   ⚠️  Verificar logs: docker compose logs ║"
fi
echo "╚══════════════════════════════════════════╝"
echo ""
echo "🌐 URL del sistema: http://${SERVER_IP}:8077"
echo ""
echo "Comandos útiles:"
echo "  docker compose logs -f        → ver logs en tiempo real"
echo "  docker compose restart app    → reiniciar solo la app"
echo "  docker compose down           → apagar todo"
echo "  cd /opt/fleetops && git pull && docker compose up -d --build  → actualizar"
echo ""
