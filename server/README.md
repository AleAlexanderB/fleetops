# FleetOPS — Backend

Sistema de control logístico con integración RedGPS para AB Construcciones.

## Estructura

```
fleetops-server/
├── src/
│   ├── core/
│   │   ├── token-manager.js    ← Gestiona el TOKEN RedGPS (renovación automática)
│   │   ├── redgps-client.js    ← Cliente HTTP base con retry en 30400
│   │   └── poller.js           ← Orquesta todos los pollings en background
│   ├── modules/
│   │   ├── redgps/
│   │   │   ├── vehiculos.js    ← Sincroniza vehículos + choferes de RedGPS
│   │   │   ├── posiciones.js   ← Polling getdata cada 30s + SSE al frontend
│   │   │   └── geocercas.js    ← Sincroniza geocercas + detección punto-en-polígono
│   │   ├── viajes/
│   │   │   └── libres.js       ← Detección automática de viajes por geocercas
│   │   └── divisiones/
│   │       └── divisiones.js   ← Config local: vehículo → división + subgrupo
│   ├── router.js               ← Todas las rutas REST
│   └── server.js               ← Entry point
├── .env.example
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## Arranque rápido

### 1. Configurar variables de entorno

```bash
cp .env.example .env
# Editar .env con las credenciales reales de RedGPS
```

### 2. Desarrollo local (sin Docker)

```bash
npm install
npm run dev
```

El servidor arranca en `http://localhost:8077`.
La primera vez tardará unos segundos en obtener el token de RedGPS.

### 3. Producción en Hyper-V con Docker

```bash
# Reemplazar 192.168.1.100 con la IP real del servidor
docker compose build --build-arg VITE_API_URL=http://192.168.1.100:8077
docker compose up -d

# Ver logs
docker compose logs -f app
```

## Endpoints disponibles

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /api/redgps/status | Estado del token y conexión con RedGPS |
| GET | /api/vehiculos | Lista de vehículos con filtros opcionales |
| GET | /api/vehiculos/resumen | Resumen por división |
| GET | /api/geocercas | Lista de geocercas |
| GET | /api/posiciones/stream | SSE — posiciones en tiempo real |
| GET | /api/viajes/libres | Viajes del día (completados + en curso) |
| GET | /api/viajes/libres/resumen | Métricas del día |
| GET | /api/divisiones | Todas las asignaciones división/subgrupo |
| GET | /api/divisiones/validas | Divisiones y subgrupos disponibles |
| PUT | /api/divisiones/:patente | Asignar división a un vehículo |

## Asignación de divisiones

El sistema usa un archivo local `data/divisiones.json` para asignar
cada vehículo a una división y subgrupo. Este archivo se edita desde
la UI (pantalla Equipos) o directamente via API:

```bash
# Asignar vehículo a división Agregados
curl -X PUT http://localhost:8077/api/divisiones/MN%20123%20AA \
  -H "Content-Type: application/json" \
  -d '{"division": "Agregados"}'

# Asignar vehículo a Obras > Obra Rolcar
curl -X PUT http://localhost:8077/api/divisiones/MN%20456%20BB \
  -H "Content-Type: application/json" \
  -d '{"division": "Obras", "subgrupo": "Obra Rolcar"}'
```

## Posiciones en tiempo real (SSE)

El frontend se conecta al endpoint SSE para recibir actualizaciones sin polling:

```javascript
const es = new EventSource('http://IP:8077/api/posiciones/stream');
es.onmessage = (e) => {
  const { type, data } = JSON.parse(e.data);
  if (type === 'posiciones') {
    // data = array de { patente, latitud, longitud, velocidad, geocerca, ... }
    actualizarMapa(data);
  }
};
```

## Notas importantes

- El servidor respeta el límite de 30 segundos entre peticiones al mismo endpoint de RedGPS
- El TOKEN se renueva automáticamente cada 5h 50min (10min antes de expirar)
- Si RedGPS devuelve código 30400 (token inválido), se renueva y reintenta automáticamente
- Las posiciones se emiten por SSE — el frontend NO necesita hacer polling
- La detección de viajes libres es automática: detecta entrada/salida de geocercas
