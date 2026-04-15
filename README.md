# FleetOPS — AB Construcciones

Sistema de control logístico con integración RedGPS.
Detecta viajes automáticamente, muestra posiciones en tiempo real y gestiona viajes programados.

## Estructura del monorepo

```
fleetops/
├── client/              ← Frontend React 18 + Vite + TailwindCSS
├── server/              ← Backend Node.js + Express
├── Dockerfile           ← Multi-stage: build client → imagen final
├── docker-compose.yml   ← app + mysql
├── .env.example         ← Template de variables de entorno
└── README.md
```

## Arranque en Hyper-V / Windows Server 2019

### Requisitos previos en la VM Linux

```bash
# Docker Engine
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Verificar
docker --version
docker compose version
```

### 1. Clonar / copiar el proyecto

```bash
scp -r fleetops/ usuario@192.168.1.100:/opt/fleetops
ssh usuario@192.168.1.100
cd /opt/fleetops
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env
nano .env
```

Campos obligatorios a completar:
- `REDGPS_APIKEY` — la APIKEY que te proveyó RedGPS
- `REDGPS_USERNAME` — usuario autorizado en RedGPS
- `REDGPS_PASSWORD` — contraseña del usuario
- `VITE_API_URL` — IP real del servidor: `http://192.168.1.100:8077`

### 3. Build y arranque

```bash
docker compose build
docker compose up -d
```

El build tarda ~2-3 minutos la primera vez (descarga imágenes base y compila el frontend).

### 4. Verificar que funciona

```bash
# Ver logs en tiempo real
docker compose logs -f app

# Verificar conexión con RedGPS
curl http://localhost:8077/api/redgps/status
# Debe devolver: { "ok": true, "redgps": { "tokenPresente": true } }
```

### 5. Acceder desde cualquier PC de la red

Abrir en el navegador: `http://192.168.1.100:8077`

---

## Desarrollo local (sin Docker)

```bash
# Terminal 1 — Backend
cd server
cp .env.example .env    # completar credenciales RedGPS
npm install
npm run dev             # puerto 8077

# Terminal 2 — Frontend
cd client
npm install
npm run dev             # puerto 3001 con proxy a 8077
```

---

## Endpoints del backend

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /api/redgps/status | Estado del token RedGPS |
| GET | /api/vehiculos | Lista de equipos con filtros |
| GET | /api/vehiculos/resumen | Resumen por división |
| GET | /api/geocercas | Geocercas desde RedGPS |
| GET | /api/posiciones/stream | SSE — posiciones en tiempo real |
| GET | /api/viajes/libres | Viajes detectados automáticamente |
| GET | /api/viajes/programados | Lista de viajes programados |
| POST | /api/viajes/programados | Crear viaje programado |
| PUT | /api/viajes/programados/:id | Actualizar viaje |
| DELETE | /api/viajes/programados/:id | Cancelar viaje |
| GET | /api/divisiones/validas | Divisiones y subgrupos disponibles |
| PUT | /api/divisiones/:patente | Asignar división a un equipo |

---

## Comandos útiles en producción

```bash
# Ver estado de los contenedores
docker compose ps

# Ver logs del servidor
docker compose logs -f app

# Reiniciar solo el servidor (sin perder DB)
docker compose restart app

# Actualizar después de cambios en el código
docker compose build app
docker compose up -d app

# Ver divisiones configuradas
curl http://localhost:8077/api/divisiones

# Asignar división a un equipo (desde línea de comando)
curl -X PUT http://localhost:8077/api/divisiones/MN%20123%20AA \
  -H "Content-Type: application/json" \
  -d '{"division": "Agregados"}'

# Asignar equipo a una obra específica
curl -X PUT http://localhost:8077/api/divisiones/MN%20456%20BB \
  -H "Content-Type: application/json" \
  -d '{"division": "Obras", "subgrupo": "Obra Rolcar"}'
```

---

## Cómo funciona la detección de viajes

1. El servidor hace polling a RedGPS cada 30 segundos con `getdata`
2. Cada posición se compara con las geocercas cargadas (círculo Haversine o polígono ray-casting)
3. Cuando un equipo entra a una geocerca → se abre un viaje nuevo
4. Cuando sale → se cierra el viaje con duración y km calculados
5. El frontend recibe las posiciones por SSE sin hacer polling desde el navegador

## Divisiones disponibles

Solo la división **Obras** tiene subgrupos. Las demás van directo a la división.

| División | Subgrupos |
|----------|-----------|
| Hormigón | No |
| Agregados | No |
| Premoldeados | No |
| **Obras** | Nombre de cada obra (Rolcar, Belgrano 450, Ruta 9, etc.) |
| Logística | No |
| Corralón | No |
| Taller | No |
