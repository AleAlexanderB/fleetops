import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Circle, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix default marker icon issue with bundlers (Leaflet + Vite/Webpack)
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// ── Internal: click handler ──────────────────────────────────────────────────

function ClickHandler({ onChange }: { onChange: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onChange(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

// ── Internal: re-center map when coords change externally ────────────────────

function MapUpdater({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap()
  useEffect(() => {
    map.setView([lat, lng], map.getZoom(), { animate: true })
  }, [lat, lng, map])
  return null
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  lat?: number
  lng?: number
  radio: number
  onChange: (lat: number, lng: number) => void
  height?: string
}

export default function MapaPuntoSelector({ lat, lng, radio, onChange, height = '300px' }: Props) {
  const defaultCenter: [number, number] = [-24.1858, -65.2995] // Jujuy, Argentina
  const center: [number, number] = lat != null && lng != null ? [lat, lng] : defaultCenter
  const hasPoint = lat != null && lng != null

  return (
    <div style={{ height, borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
      <MapContainer
        center={center}
        zoom={12}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickHandler onChange={onChange} />
        {hasPoint && (
          <>
            <Marker position={[lat!, lng!]} />
            <Circle
              center={[lat!, lng!]}
              radius={radio}
              pathOptions={{ color: '#3B82F6', fillColor: '#3B82F6', fillOpacity: 0.15, weight: 2 }}
            />
            <MapUpdater lat={lat!} lng={lng!} />
          </>
        )}
      </MapContainer>
    </div>
  )
}
