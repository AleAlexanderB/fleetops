import { useState, useMemo, lazy, Suspense } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X, Check, ChevronDown, ChevronLeft, ChevronRight, Calendar, Pencil, MapPin } from 'lucide-react'
import ColumnFilter, { useColumnFilters, uniqueValues } from '../components/ColumnFilter'
import {
  useVehiculos, useGeocercas, useDivisionesValidas,
  useViajesProgramadosHistorico,
  formatDuracion, formatTS, divisionClass,
} from '../hooks/hooks'
import { useEmpresa } from '../components/layout/Layout'
import { useAuth } from '../context/AuthContext'
import { http } from '../api/api'

const MapaPuntoSelector = lazy(() => import('../components/MapaPuntoSelector'))

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface ViajeProg {
  id: number
  patente: string
  etiqueta: string
  codigoEquipo: string | null
  chofer: string | null
  division: string | null
  subgrupo: string | null
  geocercaOrigenId: number
  geocercaOrigenNombre: string
  geocercaDestinoId: number
  geocercaDestinoNombre: string
  carga: string | null
  fechaInicio: string
  horaInicio: string
  estado: 'pendiente' | 'en_curso' | 'cumplido' | 'cancelado'
  requiereRevision?: boolean
  cumplimientoPct: number | null
  progresoPct: number | null
  distanciaRestanteKm: number | null
  distanciaEstimadaKm: number | null
  salidaReal: string | null
  llegadaReal: string | null
  duracionRealMin: number | null
  demoraSalidaMin: number | null
  kmReales: number | null
  observaciones: string | null
  estadoVehiculo: string | null
  velocidadActual: number | null
  geocercaActual: string | null
  fechaLlegadaEstimada: string | null
  horaLlegadaEstimada: string | null
  tiempoEnDestinoMin: number
  duracionEstimadaMin: number | null
  fuenteDuracion: string | null
  cantidadViajesRuta: number | null
  motivoCancelacion: string | null
}

interface ResumenProg {
  total: number; pendiente: number; en_curso: number
  cumplido: number; cancelado: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hoy() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
}

function formatFecha(iso: string) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

// ── Hooks de datos ────────────────────────────────────────────────────────────

function useViajesProgramadosDia(params: Record<string, string> = {}) {
  return useQuery({
    queryKey: ['viajes-programados', params],
    queryFn: async () => {
      const r = await http.get('/viajes/programados', { params })
      return r.data as { ok: boolean; resumen: ResumenProg; data: ViajeProg[] }
    },
    refetchInterval: 30_000,
  })
}

function useCrearViaje() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const post = (b: Record<string, unknown>) => http.post('/viajes/programados', b)
      try {
        const r = await post(body)
        if (!r.data.ok) throw new Error(r.data.error)
        return r.data
      } catch (e: unknown) {
        const err = e as { response?: { status?: number; data?: { code?: string; detalle?: { origenNombre?: string; destinoNombre?: string; fechaInicio?: string; horaInicio?: string; requiereRevision?: boolean } } } }
        const data = err.response?.data
        if (err.response?.status === 409 && data?.code === 'EQUIPO_OCUPADO') {
          const d = data.detalle ?? {}
          const advertencia = d.requiereRevision
            ? '\n\n⚠ Ese viaje en curso tiene más de 36h sin confirmar llegada — puede que ya haya terminado.'
            : ''
          const codigoEquipo = (body.codigoEquipo ?? body.patente ?? 'el equipo') as string
          const ok = window.confirm(
            `${codigoEquipo} ya tiene un viaje en curso:\n\n` +
            `${d.origenNombre ?? '?'} → ${d.destinoNombre ?? '?'}\n` +
            `Programado: ${d.fechaInicio ?? '?'} ${d.horaInicio ?? ''}` +
            advertencia +
            `\n\n¿Crear este nuevo viaje de todos modos?`
          )
          if (!ok) throw new Error('Operación cancelada por el usuario')
          const r2 = await post({ ...body, forzar: true })
          if (!r2.data.ok) throw new Error(r2.data.error)
          return r2.data
        }
        throw e
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['viajes-programados'] }),
  })
}

function useEditarViaje() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: number; body: Record<string, unknown> }) => {
      const r = await http.put(`/viajes/programados/${id}`, body)
      if (!r.data.ok) throw new Error(r.data.error)
      return r.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['viajes-programados'] }),
  })
}

function useCancelarViaje() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, motivo }: { id: number; motivo: string }) => {
      const r = await http.request({
        method: 'DELETE',
        url: `/viajes/programados/${id}`,
        data: { motivo },
      })
      return r.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['viajes-programados'] }),
  })
}

// ── Componentes pequeños ──────────────────────────────────────────────────────

function EstadoBadge({ estado }: { estado: ViajeProg['estado'] }) {
  const map: Record<string, { cls: string; label: string }> = {
    pendiente: { cls: 'badge-gray',  label: 'Pendiente' },
    en_curso:  { cls: 'badge-blue',  label: 'En curso'  },
    cumplido:  { cls: 'badge-green', label: 'Cumplido'  },
    cancelado: { cls: 'badge-gray',  label: 'Cancelado' },
  }
  const { cls, label } = map[estado] ?? { cls: 'badge-gray', label: estado }
  return <span className={`badge ${cls}`}><span className="w-[5px] h-[5px] rounded-full bg-current" />{label}</span>
}

function CumplBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-[#6E7681]">—</span>
  const color = pct >= 80 ? '#10B981' : pct >= 50 ? '#F59E0B' : '#EF4444'
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className="flex-1 h-[5px] bg-[#21273A] rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[11px] font-semibold" style={{ color }}>{pct}%</span>
    </div>
  )
}

function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: string; count?: number }[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className="flex gap-1 bg-[#161B22] border border-white/[0.07] rounded-lg p-0.5">
      {tabs.map(t => (
        <button
          key={t.key}
          className={`px-3.5 py-1.5 rounded-md text-[12px] font-medium transition-colors flex items-center gap-1.5 ${
            active === t.key ? 'bg-brand text-white' : 'text-[#8B949E] hover:text-[#E6EDF3]'
          }`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && (
            <span className={`text-[10px] px-1.5 py-0 rounded-full ${active === t.key ? 'bg-white/20' : 'bg-white/[0.07]'}`}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

// ── Modal Crear/Editar Viaje ─────────────────────────────────────────────────

function ViajeModal({ onClose, editando }: { onClose: () => void; editando?: ViajeProg | null }) {
  const { empresa } = useEmpresa()
  const { data: vehiculos = [] }       = useVehiculos({ empresa: empresa || undefined })
  const { data: geocercas = [] }       = useGeocercas({ empresa: empresa || undefined })
  const { data: validas }              = useDivisionesValidas()
  const crear  = useCrearViaje()
  const editar = useEditarViaje()
  const isPending = crear.isPending || editar.isPending
  const isError   = crear.isError   || editar.isError

  const today = hoy()
  const [f, setF] = useState({
    codigoEquipo: editando?.codigoEquipo ?? '',
    patente: editando?.patente ?? '',
    chofer: editando?.chofer ?? '',
    division: editando?.division ?? '',
    subgrupo: editando?.subgrupo ?? '',
    geocercaOrigenId: editando?.geocercaOrigenId?.toString() ?? '',
    geocercaOrigenNombre: editando?.geocercaOrigenNombre ?? '',
    geocercaDestinoId: editando?.geocercaDestinoId?.toString() ?? '',
    geocercaDestinoNombre: editando?.geocercaDestinoNombre ?? '',
    carga: editando?.carga ?? '',
    fechaInicio: editando?.fechaInicio ?? today,
    horaInicio: editando?.horaInicio?.slice(0, 5) ?? '08:00',
    observaciones: editando?.observaciones ?? '',
    fechaLlegadaEstimada: (editando as any)?.fechaLlegadaEstimada ?? '',
    horaLlegadaEstimada: (editando as any)?.horaLlegadaEstimada?.slice(0, 5) ?? '',
    origenCustom: false,
    origenNombreCustom: '',
    origenLat: null as number | null,
    origenLng: null as number | null,
    origenRadio: 200,
    destinoCustom: false,
    destinoNombreCustom: '',
    destinoLat: null as number | null,
    destinoLng: null as number | null,
    destinoRadio: 200,
    tiempoEnDestinoMin: editando?.tiempoEnDestinoMin?.toString() ?? '60',
  })
  const [mostrarLlegada, setMostrarLlegada] = useState(!!(editando as any)?.fechaLlegadaEstimada)

  const set = (k: string, v: string) => setF(prev => ({ ...prev, [k]: v }))

  const setVehiculo = (codigo: string) => {
    const v = vehiculos.find(v => v.codigo === codigo)
    setF(prev => ({
      ...prev,
      codigoEquipo: codigo,
      patente:  v?.patente ?? '',
      chofer:   v?.chofer?.nombre ?? prev.chofer,
      division: v?.division ?? prev.division,
      subgrupo: v?.subgrupo ?? prev.subgrupo,
    }))
  }

  const setGeo = (tipo: 'Origen' | 'Destino', idStr: string) => {
    const geo = geocercas.find(g => String(g.idCerca) === idStr)
    setF(prev => ({
      ...prev,
      [`geocerca${tipo}Id`]:     idStr,
      [`geocerca${tipo}Nombre`]: geo?.nombre ?? '',
    }))
  }

  const submit = () => {
    const origenOk = f.origenCustom ? (f.origenNombreCustom && f.origenLat != null && f.origenLng != null) : !!f.geocercaOrigenId
    const destinoOk = f.destinoCustom ? (f.destinoNombreCustom && f.destinoLat != null && f.destinoLng != null) : !!f.geocercaDestinoId
    if (!f.codigoEquipo || !origenOk || !destinoOk) return

    const body: Record<string, unknown> = {
      ...f,
      geocercaOrigenId:  f.origenCustom ? 0 : Number(f.geocercaOrigenId),
      geocercaOrigenNombre: f.origenCustom ? f.origenNombreCustom : f.geocercaOrigenNombre,
      geocercaDestinoId: f.destinoCustom ? 0 : Number(f.geocercaDestinoId),
      geocercaDestinoNombre: f.destinoCustom ? f.destinoNombreCustom : f.geocercaDestinoNombre,
      horaInicio:        f.horaInicio.length === 5 ? f.horaInicio + ':00' : f.horaInicio,
      tiempoEnDestinoMin: parseInt(f.tiempoEnDestinoMin) || 60,
    }
    if (f.origenCustom) {
      body.origenLat = f.origenLat
      body.origenLng = f.origenLng
      body.origenRadio = f.origenRadio
    }
    if (f.destinoCustom) {
      body.destinoLat = f.destinoLat
      body.destinoLng = f.destinoLng
      body.destinoRadio = f.destinoRadio
    }
    if (mostrarLlegada && f.fechaLlegadaEstimada) {
      body.fechaLlegadaEstimada = f.fechaLlegadaEstimada
      body.horaLlegadaEstimada = f.horaLlegadaEstimada ? (f.horaLlegadaEstimada.length === 5 ? f.horaLlegadaEstimada + ':00' : f.horaLlegadaEstimada) : null
    } else {
      body.fechaLlegadaEstimada = null
      body.horaLlegadaEstimada = null
    }
    if (editando) {
      editar.mutate({ id: editando.id, body }, { onSuccess: () => onClose() })
    } else {
      crear.mutate(body, { onSuccess: () => onClose() })
    }
  }

  const origenValid = f.origenCustom ? !!(f.origenNombreCustom && f.origenLat != null && f.origenLng != null) : !!f.geocercaOrigenId
  const destinoValid = f.destinoCustom ? !!(f.destinoNombreCustom && f.destinoLat != null && f.destinoLng != null) : !!f.geocercaDestinoId
  const canSubmit = f.codigoEquipo && origenValid && destinoValid && !isPending

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-[#161B22] border border-white/[0.12] rounded-xl w-full max-w-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
          <h2 className="text-[14px] font-semibold">{editando ? 'Editar viaje programado' : 'Nuevo viaje programado'}</h2>
          <button onClick={onClose} className="text-[#6E7681] hover:text-[#E6EDF3] transition-colors"><X size={16} /></button>
        </div>
        <div className="p-5 flex flex-col gap-3 max-h-[70vh] overflow-y-auto">
          <label className="block">
            <span className="text-[11px] text-[#8B949E] mb-1 block">Equipo *</span>
            <select className="input w-full" value={f.codigoEquipo} onChange={e => setVehiculo(e.target.value)}>
              <option value="">Seleccionar equipo...</option>
              {vehiculos.map(v => (
                <option key={v.codigo} value={v.codigo}>
                  {v.codigo} {v.patente && v.patente !== v.codigo ? `(${v.patente})` : ''}
                  {v.division ? ` · ${v.division}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] text-[#8B949E] mb-1 block">Chofer</span>
            <input className="input w-full" value={f.chofer} onChange={e => set('chofer', e.target.value)} placeholder="Nombre del chofer" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] text-[#8B949E] mb-1 block">Unidad de negocio</span>
              <select className="input w-full" value={f.division} onChange={e => { set('division', e.target.value); set('subgrupo', '') }}>
                <option value="">Sin unidad de negocio</option>
                {validas?.divisiones.map(d => <option key={d}>{d}</option>)}
              </select>
            </label>
            {f.division === 'Obras' && (
              <label className="block">
                <span className="text-[11px] text-[#8B949E] mb-1 block">Subgrupo / Obra</span>
                <input className="input w-full" value={f.subgrupo} onChange={e => set('subgrupo', e.target.value)} placeholder="Nombre de obra" />
              </label>
            )}
          </div>
          {/* Origen */}
          <div>
            <span className="text-[11px] text-[#8B949E] mb-1 block">Origen *</span>
            {!f.origenCustom ? (
              <>
                <select className="input w-full" value={f.geocercaOrigenId} onChange={e => setGeo('Origen', e.target.value)}>
                  <option value="">Seleccionar...</option>
                  {geocercas.filter(g => g.visible).map(g => <option key={g.idCerca} value={g.idCerca}>{g.nombre}</option>)}
                </select>
                <button
                  type="button"
                  className="flex items-center gap-1 mt-1.5 text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
                  onClick={() => setF(prev => ({ ...prev, origenCustom: true, geocercaOrigenId: '', geocercaOrigenNombre: '' }))}
                >
                  <MapPin size={11} /> Usar punto personalizado
                </button>
              </>
            ) : (
              <div className="bg-[#1e2229] rounded-lg p-3 flex flex-col gap-2 border border-white/[0.07]">
                <input
                  className="input w-full"
                  placeholder="Nombre del punto *"
                  value={f.origenNombreCustom}
                  onChange={e => setF(prev => ({ ...prev, origenNombreCustom: e.target.value }))}
                />
                <Suspense fallback={<div className="h-[300px] bg-[#161B22] rounded-lg flex items-center justify-center text-[#6E7681] text-[12px]">Cargando mapa...</div>}>
                  <MapaPuntoSelector
                    lat={f.origenLat ?? undefined}
                    lng={f.origenLng ?? undefined}
                    radio={f.origenRadio}
                    onChange={(lat, lng) => setF(prev => ({ ...prev, origenLat: lat, origenLng: lng }))}
                  />
                </Suspense>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className="text-[10px] text-[#6E7681] block mb-0.5">Latitud</span>
                    <input
                      type="number"
                      step="0.000001"
                      className="input w-full text-[11px]"
                      value={f.origenLat ?? ''}
                      onChange={e => setF(prev => ({ ...prev, origenLat: e.target.value ? Number(e.target.value) : null }))}
                      placeholder="-24.1858"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-[#6E7681] block mb-0.5">Longitud</span>
                    <input
                      type="number"
                      step="0.000001"
                      className="input w-full text-[11px]"
                      value={f.origenLng ?? ''}
                      onChange={e => setF(prev => ({ ...prev, origenLng: e.target.value ? Number(e.target.value) : null }))}
                      placeholder="-65.2995"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-[#6E7681] block mb-0.5">Radio (m)</span>
                    <input
                      type="number"
                      min={50}
                      max={2000}
                      className="input w-full text-[11px]"
                      value={f.origenRadio}
                      onChange={e => setF(prev => ({ ...prev, origenRadio: Number(e.target.value) || 200 }))}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
                  onClick={() => setF(prev => ({ ...prev, origenCustom: false, origenNombreCustom: '', origenLat: null, origenLng: null, origenRadio: 200 }))}
                >
                  <MapPin size={11} /> Usar geocerca existente
                </button>
              </div>
            )}
          </div>

          {/* Destino */}
          <div>
            <span className="text-[11px] text-[#8B949E] mb-1 block">Destino *</span>
            {!f.destinoCustom ? (
              <>
                <select className="input w-full" value={f.geocercaDestinoId} onChange={e => setGeo('Destino', e.target.value)}>
                  <option value="">Seleccionar...</option>
                  {geocercas.filter(g => g.visible).map(g => <option key={g.idCerca} value={g.idCerca}>{g.nombre}</option>)}
                </select>
                <button
                  type="button"
                  className="flex items-center gap-1 mt-1.5 text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
                  onClick={() => setF(prev => ({ ...prev, destinoCustom: true, geocercaDestinoId: '', geocercaDestinoNombre: '' }))}
                >
                  <MapPin size={11} /> Usar punto personalizado
                </button>
              </>
            ) : (
              <div className="bg-[#1e2229] rounded-lg p-3 flex flex-col gap-2 border border-white/[0.07]">
                <input
                  className="input w-full"
                  placeholder="Nombre del punto *"
                  value={f.destinoNombreCustom}
                  onChange={e => setF(prev => ({ ...prev, destinoNombreCustom: e.target.value }))}
                />
                <Suspense fallback={<div className="h-[300px] bg-[#161B22] rounded-lg flex items-center justify-center text-[#6E7681] text-[12px]">Cargando mapa...</div>}>
                  <MapaPuntoSelector
                    lat={f.destinoLat ?? undefined}
                    lng={f.destinoLng ?? undefined}
                    radio={f.destinoRadio}
                    onChange={(lat, lng) => setF(prev => ({ ...prev, destinoLat: lat, destinoLng: lng }))}
                  />
                </Suspense>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className="text-[10px] text-[#6E7681] block mb-0.5">Latitud</span>
                    <input
                      type="number"
                      step="0.000001"
                      className="input w-full text-[11px]"
                      value={f.destinoLat ?? ''}
                      onChange={e => setF(prev => ({ ...prev, destinoLat: e.target.value ? Number(e.target.value) : null }))}
                      placeholder="-24.1858"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-[#6E7681] block mb-0.5">Longitud</span>
                    <input
                      type="number"
                      step="0.000001"
                      className="input w-full text-[11px]"
                      value={f.destinoLng ?? ''}
                      onChange={e => setF(prev => ({ ...prev, destinoLng: e.target.value ? Number(e.target.value) : null }))}
                      placeholder="-65.2995"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-[#6E7681] block mb-0.5">Radio (m)</span>
                    <input
                      type="number"
                      min={50}
                      max={2000}
                      className="input w-full text-[11px]"
                      value={f.destinoRadio}
                      onChange={e => setF(prev => ({ ...prev, destinoRadio: Number(e.target.value) || 200 }))}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
                  onClick={() => setF(prev => ({ ...prev, destinoCustom: false, destinoNombreCustom: '', destinoLat: null, destinoLng: null, destinoRadio: 200 }))}
                >
                  <MapPin size={11} /> Usar geocerca existente
                </button>
              </div>
            )}
          </div>
          <label className="block">
            <span className="text-[11px] text-[#8B949E] mb-1 block">Tiempo en destino (min)</span>
            <input
              type="number"
              min={0}
              max={480}
              className="input w-full"
              value={f.tiempoEnDestinoMin}
              onChange={e => set('tiempoEnDestinoMin', e.target.value)}
              placeholder="60"
            />
            <span className="text-[9px] text-[#6E7681] mt-0.5 block">Tiempo estimado de descarga/carga en destino</span>
          </label>
          <label className="block">
            <span className="text-[11px] text-[#8B949E] mb-1 block">Carga / Descripción</span>
            <input className="input w-full" value={f.carga} onChange={e => set('carga', e.target.value)} placeholder="Ej: Áridos 14T, Hormigón H25 8m³..." />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] text-[#8B949E] mb-1 block">Fecha de salida *</span>
              <input type="date" className="input w-full" value={f.fechaInicio} onChange={e => set('fechaInicio', e.target.value)} />
            </label>
            <label className="block">
              <span className="text-[11px] text-[#8B949E] mb-1 block">Hora de salida</span>
              <input type="time" className="input w-full" value={f.horaInicio} onChange={e => set('horaInicio', e.target.value)} />
            </label>
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={mostrarLlegada}
              onChange={e => {
                setMostrarLlegada(e.target.checked)
                if (!e.target.checked) { set('fechaLlegadaEstimada', ''); set('horaLlegadaEstimada', '') }
              }}
              className="accent-brand w-3.5 h-3.5"
            />
            <span className="text-[11px] text-[#8B949E]">Establecer hora de llegada estimada</span>
          </label>
          {mostrarLlegada && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[11px] text-[#8B949E] mb-1 block">Fecha llegada estimada</span>
                <input type="date" className="input w-full" value={f.fechaLlegadaEstimada} onChange={e => set('fechaLlegadaEstimada', e.target.value)} />
              </label>
              <label className="block">
                <span className="text-[11px] text-[#8B949E] mb-1 block">Hora llegada estimada</span>
                <input type="time" className="input w-full" value={f.horaLlegadaEstimada} onChange={e => set('horaLlegadaEstimada', e.target.value)} />
              </label>
            </div>
          )}
          <label className="block">
            <span className="text-[11px] text-[#8B949E] mb-1 block">Observaciones</span>
            <textarea className="input w-full resize-none" rows={2} value={f.observaciones} onChange={e => set('observaciones', e.target.value)} placeholder="Opcional..." />
          </label>
          {isError && <p className="text-[12px] text-red-400 bg-red-500/10 rounded-md px-3 py-2">Error al guardar. Verificá los campos requeridos.</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-white/[0.07]">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={submit} disabled={!canSubmit}>
            {isPending ? 'Guardando...' : <><Check size={12} />{editando ? 'Guardar cambios' : 'Guardar viaje'}</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Tabla de viajes (reutilizable) ───────────────────────────────────────────

function TablaViajes({ viajes, onEdit, onCancel, showExpand = true }: {
  viajes: ViajeProg[]
  onEdit?: (v: ViajeProg) => void
  onCancel?: (id: number) => void
  showExpand?: boolean
}) {
  const [expanded, setExpanded] = useState<number | null>(null)
  const [filters, setFilter, clearFilters, hasFilters] = useColumnFilters([
    'equipo', 'chofer', 'division', 'origen', 'estado'
  ])

  const filteredViajes = viajes.filter(v => {
    if (filters.equipo.size > 0 && !filters.equipo.has(v.codigoEquipo ?? v.etiqueta ?? '—')) return false
    if (filters.chofer.size > 0 && !filters.chofer.has(v.chofer || 'Sin chofer')) return false
    if (filters.division.size > 0 && !filters.division.has(v.division || '—')) return false
    if (filters.origen.size > 0) {
      const ruta = `${v.geocercaOrigenNombre} → ${v.geocercaDestinoNombre}`
      if (!filters.origen.has(ruta)) return false
    }
    if (filters.estado.size > 0) {
      const label = { pendiente:'Pendiente', en_curso:'En curso', cumplido:'Cumplido', retrasado:'Retrasado', cancelado:'Cancelado' }[v.estado] || v.estado
      if (!filters.estado.has(label)) return false
    }
    return true
  })

  if (filteredViajes.length === 0) return (
    <div className="p-10 text-center text-[#6E7681] text-[13px]">
      {hasFilters ? (
        <>No hay viajes con los filtros seleccionados. <button className="text-blue-400 ml-1" onClick={clearFilters}>Limpiar filtros</button></>
      ) : 'Sin viajes en esta vista'}
    </div>
  )

  return (
    <div className="overflow-x-auto">
      {hasFilters && (
        <div className="px-4 py-2 border-b border-white/[0.06] flex items-center gap-2">
          <span className="text-[11px] text-[#6E7681]">Filtros activos</span>
          <button className="text-[11px] text-blue-400 hover:text-blue-300" onClick={clearFilters}>Limpiar</button>
        </div>
      )}
      <table className="tbl">
        <thead>
          <tr>
            <th>#</th>
            <th><ColumnFilter title="Equipo" values={uniqueValues(viajes, v => v.codigoEquipo ?? v.etiqueta ?? '—')} selected={filters.equipo} onChange={s => setFilter('equipo', s)} /></th>
            <th><ColumnFilter title="Chofer" values={uniqueValues(viajes, v => v.chofer || 'Sin chofer')} selected={filters.chofer} onChange={s => setFilter('chofer', s)} /></th>
            <th><ColumnFilter title="Unidad de negocio" values={uniqueValues(viajes, v => v.division || '—')} selected={filters.division} onChange={s => setFilter('division', s)} /></th>
            <th><ColumnFilter title="Ruta" values={uniqueValues(viajes, v => `${v.geocercaOrigenNombre} → ${v.geocercaDestinoNombre}`)} selected={filters.origen} onChange={s => setFilter('origen', s)} /></th>
            <th>Carga</th>
            <th>Fecha prog.</th>
            <th>Salida / Llegada</th>
            <th>Puntualidad</th>
            <th>Descarga</th>
            <th>Dist. destino</th>
            <th><ColumnFilter title="Estado" values={uniqueValues(viajes, v => ({pendiente:'Pendiente',en_curso:'En curso',cumplido:'Cumplido',cancelado:'Cancelado'})[v.estado] || v.estado)} selected={filters.estado} onChange={s => setFilter('estado', s)} /></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filteredViajes.map(v => (
            <>
              <tr
                key={v.id}
                className={showExpand ? 'cursor-pointer' : ''}
                onClick={() => showExpand && setExpanded(expanded === v.id ? null : v.id)}
              >
                <td className="text-[#6E7681] text-[11px]">{v.id}</td>
                <td>
                  <span className="font-semibold font-mono">{v.codigoEquipo ?? v.etiqueta}</span>
                  {v.patente && v.patente !== v.codigoEquipo && (
                    <p className="text-[10px] text-[#6E7681]">{v.patente}</p>
                  )}
                </td>
                <td>
                  {v.chofer
                    ? <div className="drv-chip"><div className="drv-av">{v.chofer.slice(0,2).toUpperCase()}</div>{v.chofer}</div>
                    : <span className="text-[#6E7681]">—</span>}
                </td>
                <td>
                  {v.division
                    ? <><span className={`badge ${divisionClass(v.division)}`}>{v.division}</span>
                        {v.subgrupo && <p className="text-[9px] text-[#6E7681] mt-0.5">↳ {v.subgrupo}</p>}</>
                    : <span className="text-[#6E7681]">—</span>}
                </td>
                <td className="text-[#8B949E] max-w-[180px] truncate">{v.geocercaOrigenNombre} → {v.geocercaDestinoNombre}</td>
                <td className="text-[#8B949E]">{v.carga ?? '—'}</td>
                <td className="text-[#6E7681] text-[11px]">{formatFecha(v.fechaInicio)} {v.horaInicio.slice(0,5)}</td>
                {/* Salida / Llegada */}
                <td className="text-[11px]">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-[#6E7681] w-[10px]">S</span>
                      <span className={v.salidaReal ? 'text-[#E6EDF3]' : 'text-[#6E7681]'}>{formatTS(v.salidaReal) || '—'}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-[#6E7681] w-[10px]">L</span>
                      <span className={v.llegadaReal ? 'text-[#E6EDF3]' : 'text-[#6E7681]'}>{formatTS(v.llegadaReal) || '—'}</span>
                    </div>
                  </div>
                </td>
                {/* Puntualidad salida/llegada */}
                <td className="text-[11px]">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-[#6E7681] w-[10px]">S</span>
                      {v.demoraSalidaMin != null
                        ? <span className={`font-semibold ${v.demoraSalidaMin > 15 ? 'text-red-400' : v.demoraSalidaMin < 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {v.demoraSalidaMin > 0 ? `+${v.demoraSalidaMin}'` : v.demoraSalidaMin < 0 ? `${Math.abs(v.demoraSalidaMin)}' antes` : 'OK'}
                          </span>
                        : <span className="text-[#6E7681]">—</span>}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-[#6E7681] w-[10px]">L</span>
                      {v.llegadaReal
                        ? (() => {
                            // Hora llegada programada = hora salida programada + tiempo viaje estimado
                            const salidaProgMin = horaAMinutos(v.horaInicio)
                            const estViajeMin = v.duracionEstimadaMin ?? (v.distanciaEstimadaKm ? Math.round((v.distanciaEstimadaKm / 40) * 60) : (v.duracionRealMin ?? 60))
                            const llegadaProgMin = salidaProgMin + estViajeMin
                            // Hora llegada real
                            const lr = new Date(v.llegadaReal)
                            const llegadaRealMin = lr.getHours() * 60 + lr.getMinutes()
                            const diffLlegada = llegadaRealMin - llegadaProgMin
                            return <span className={`font-semibold ${diffLlegada > 15 ? 'text-red-400' : diffLlegada < -5 ? 'text-emerald-400' : 'text-amber-400'}`}>
                              {diffLlegada > 0 ? `+${diffLlegada}'` : diffLlegada < 0 ? `${Math.abs(diffLlegada)}' antes` : 'OK'}
                            </span>
                          })()
                        : <span className="text-[#6E7681]">—</span>}
                    </div>
                  </div>
                </td>
                {/* Descarga: programado vs real */}
                <td className="text-[11px]">
                  {v.estado === 'cumplido' || v.estado === 'en_curso'
                    ? <div className="flex flex-col gap-0.5">
                        <span className="text-[#6E7681] text-[10px]">{v.tiempoEnDestinoMin ?? 60}' prog.</span>
                        {v.llegadaReal
                          ? <span className="text-[#E6EDF3] font-semibold">—</span>
                          : v.estado === 'en_curso' && v.estadoVehiculo
                            ? <span className={`text-[10px] ${v.estadoVehiculo === 'en_ruta' ? 'text-blue-400' : 'text-amber-400'}`}>
                                {v.estadoVehiculo === 'en_ruta' ? 'En viaje' : 'En destino'}
                              </span>
                            : null}
                      </div>
                    : <span className="text-[#6E7681]">{v.tiempoEnDestinoMin ?? 60}'</span>}
                </td>
                {/* Dist. destino */}
                <td>
                  {v.estado === 'en_curso'
                    ? <div className="flex flex-col gap-0.5">
                        {v.distanciaRestanteKm != null && (
                          <span className="text-[11px] text-amber-400 font-semibold">{v.distanciaRestanteKm} km</span>
                        )}
                        {v.progresoPct != null && <CumplBar pct={v.progresoPct} />}
                        {v.estadoVehiculo && (
                          <span className={`text-[9px] font-medium ${
                            v.estadoVehiculo === 'en_ruta' ? 'text-emerald-400' :
                            v.estadoVehiculo === 'detenido_encendido' ? 'text-amber-400' : 'text-red-400'
                          }`}>
                            {v.estadoVehiculo === 'en_ruta' ? `${Math.round(v.velocidadActual ?? 0)} km/h` :
                             v.estadoVehiculo === 'detenido_encendido' ? 'Detenido' : 'Motor apagado'}
                          </span>
                        )}
                      </div>
                    : v.estado === 'cumplido'
                      ? <span className="text-[11px] text-emerald-400 font-semibold">{v.kmReales != null ? `${v.kmReales} km` : '—'}</span>
                      : <span className="text-[#6E7681]">—</span>}
                </td>
                <td>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <EstadoBadge estado={v.estado} />
                    {v.requiereRevision && (
                      <span className="badge text-[10px] bg-red-500/15 text-red-300 border border-red-500/40" title="Salió hace más de 36h sin confirmar llegada — revisá si llegó a destino o cancelá el viaje">
                        ⚠ Revisar
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  <div className="flex items-center gap-1.5">
                    {showExpand && <ChevronDown size={12} className={`text-[#6E7681] transition-transform ${expanded === v.id ? 'rotate-180' : ''}`} />}
                    {onEdit && v.estado !== 'cancelado' && v.estado !== 'cumplido' && (
                      <button className="btn btn-ghost text-[10px] px-2 py-0.5" onClick={e => { e.stopPropagation(); onEdit(v) }} title="Editar">
                        <Pencil size={10} />
                      </button>
                    )}
                    {onCancel && v.estado !== 'cancelado' && v.estado !== 'cumplido' && (
                      <button
                        className="btn btn-ghost text-[10px] px-2 py-0.5 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        onClick={e => { e.stopPropagation(); onCancel(v.id) }}
                        title="Cancelar viaje"
                      >
                        <X size={10} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              {showExpand && expanded === v.id && (
                <tr key={`exp-${v.id}`}>
                  <td colSpan={13} className="bg-[#1C2333] px-6 py-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-5 text-[12px]">
                      <div>
                        <p className="text-[10px] text-[#6E7681] uppercase tracking-wide mb-1.5">Salida programada</p>
                        <p className="font-semibold">{formatFecha(v.fechaInicio)}</p>
                        <p className="text-amber-400">{v.horaInicio.slice(0,5)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[#6E7681] uppercase tracking-wide mb-1.5">Salida real (GPS)</p>
                        {v.salidaReal
                          ? <>
                              <p className="font-semibold">{new Date(v.salidaReal).toLocaleDateString('es-AR')}</p>
                              <p className="text-emerald-400">{formatTS(v.salidaReal)}</p>
                              {v.demoraSalidaMin != null && v.demoraSalidaMin !== 0 && (
                                <p className={`text-[10px] mt-1 ${v.demoraSalidaMin > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                                  {v.demoraSalidaMin > 0 ? `+${v.demoraSalidaMin} min de retraso` : `${Math.abs(v.demoraSalidaMin)} min antes`}
                                </p>
                              )}
                            </>
                          : <p className="text-[#6E7681]">No detectada aún</p>}
                      </div>
                      <div>
                        <p className="text-[10px] text-[#6E7681] uppercase tracking-wide mb-1.5">Llegada real</p>
                        {v.llegadaReal
                          ? <>
                              <p className="font-semibold">{formatTS(v.llegadaReal)}</p>
                              {v.duracionRealMin != null && <p className="text-amber-400 text-[11px]">{formatDuracion(v.duracionRealMin)}</p>}
                            </>
                          : <p className="text-[#6E7681]">{v.estado === 'en_curso' ? 'En curso...' : '—'}</p>}
                      </div>
                      <div>
                        <p className="text-[10px] text-[#6E7681] uppercase tracking-wide mb-1.5">Km recorridos</p>
                        <p className="font-semibold text-[14px]">
                          {v.kmReales != null ? `${v.kmReales} km` : <span className="text-[#6E7681]">—</span>}
                        </p>
                      </div>
                    </div>
                    {v.estado === 'cancelado' && v.motivoCancelacion && (
                      <div className="mt-3 pt-2.5 border-t border-white/[0.07] flex items-start gap-2">
                        <X size={12} className="text-red-400 mt-0.5 shrink-0" />
                        <p className="text-[11px] text-red-300">
                          <span className="text-[#6E7681] uppercase tracking-wide">Motivo de cancelación: </span>
                          <span className="font-semibold">{v.motivoCancelacion}</span>
                        </p>
                      </div>
                    )}
                    {v.observaciones && (
                      <p className="mt-3 pt-2.5 border-t border-white/[0.07] text-[11px] text-[#8B949E]">
                        <span className="text-[#6E7681]">Observaciones: </span>{v.observaciones}
                      </p>
                    )}
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Vista: Hoy ───────────────────────────────────────────────────────────────

function VistaHoy({ onEdit, onNuevo, onCancel, empresa }: { onEdit: (v: ViajeProg) => void; onNuevo: () => void; onCancel?: (id: number) => void; empresa: string }) {
  const todayStr = hoy()
  // incluirEnCurso=true: un viaje que arrancó ayer y todavía no llegó a destino
  // sigue siendo trabajo activo del día — debe verse en la pestaña "Hoy".
  const params: Record<string, string> = { fecha: todayStr, incluirEnCurso: 'true' }
  if (empresa) params.empresa = empresa
  const { data, isLoading } = useViajesProgramadosDia(params)

  const viajes  = data?.data ?? []
  const resumen = data?.resumen

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat-card"><p className="stat-label">Total activos</p><p className="stat-value text-blue-400">{resumen?.total ?? '—'}</p></div>
        <div className="stat-card"><p className="stat-label">Pendientes</p><p className="stat-value text-[#8B949E]">{resumen?.pendiente ?? '—'}</p></div>
        <div className="stat-card"><p className="stat-label">En curso</p><p className="stat-value text-blue-400">{resumen?.en_curso ?? '—'}</p></div>
        <div className="stat-card"><p className="stat-label">Cumplidos hoy</p><p className="stat-value text-emerald-400">{resumen?.cumplido ?? '—'}</p></div>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="p-8 text-center text-[#6E7681] text-[13px]">Cargando...</div>
        ) : viajes.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-[14px] font-semibold mb-1">Sin viajes activos</p>
            <p className="text-[13px] text-[#8B949E] mb-4">Creá uno con el botón "Nuevo viaje".</p>
            <button className="btn btn-primary" onClick={onNuevo}><Plus size={13} />Nuevo viaje</button>
          </div>
        ) : (
          <TablaViajes viajes={viajes} onEdit={onEdit} onCancel={onCancel} />
        )}
      </div>
    </>
  )
}

// ── Vista: Histórico (pasados) ───────────────────────────────────────────────

function VistaHistorico({ onEdit, onCancel, empresa }: { onEdit: (v: ViajeProg) => void; onCancel?: (id: number) => void; empresa: string }) {
  const todayStr = hoy()
  // Ayer por defecto
  const ayerDate = new Date(); ayerDate.setDate(ayerDate.getDate() - 1)
  const ayerStr  = ayerDate.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

  const [desde, setDesde] = useState(ayerStr)
  const [hasta, setHasta] = useState(ayerStr)
  const [filtEst, setFiltEst] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 50

  const { data, isLoading } = useViajesProgramadosHistorico(
    { desde, hasta, estado: filtEst || undefined, page, pageSize, empresa: empresa || undefined },
    true
  )

  const viajes     = data?.data ?? []
  const total      = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const fmt = (dt: Date) => dt.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
  const moverDias = (n: number) => {
    const d = new Date(desde + 'T12:00:00'); d.setDate(d.getDate() + n)
    const h = new Date(hasta + 'T12:00:00'); h.setDate(h.getDate() + n)
    if (fmt(h) >= todayStr) return
    setDesde(fmt(d)); setHasta(fmt(h)); setPage(1)
  }

  return (
    <>
      <div className="flex gap-2 flex-wrap items-center">
        <button className="btn btn-ghost p-1.5" onClick={() => moverDias(-1)}><ChevronLeft size={14} /></button>
        <div className="flex items-center gap-1.5 bg-[#161B22] border border-white/[0.08] rounded-lg px-3 py-1.5">
          <Calendar size={13} className="text-[#6E7681]" />
          <input type="date" className="bg-transparent text-[12px] text-[#E6EDF3] outline-none w-[110px]" value={desde} max={hasta} onChange={e => { setDesde(e.target.value); setPage(1) }} />
          <span className="text-[#6E7681] text-[11px]">→</span>
          <input type="date" className="bg-transparent text-[12px] text-[#E6EDF3] outline-none w-[110px]" value={hasta} min={desde} max={todayStr} onChange={e => { setHasta(e.target.value); setPage(1) }} />
        </div>
        <button className="btn btn-ghost p-1.5" onClick={() => moverDias(1)}><ChevronRight size={14} /></button>
        <select className="input" value={filtEst} onChange={e => { setFiltEst(e.target.value); setPage(1) }}>
          <option value="">Todos los estados</option>
          <option value="cumplido">Cumplido</option>
          <option value="retrasado">Retrasado</option>
          <option value="cancelado">Cancelado</option>
        </select>
      </div>

      <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3.5 py-2.5 text-[12px] text-blue-300">
        <Calendar size={13} />
        Viajes pasados del {formatFecha(desde)} {desde !== hasta ? ` al ${formatFecha(hasta)}` : ''}
        {data?.source === 'mysql' && <span className="text-blue-400/60 ml-1">· MySQL</span>}
        <span className="ml-auto text-blue-400/60">{total} viajes</span>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="p-8 text-center text-[#6E7681] text-[13px]">Cargando...</div>
        ) : (
          <>
            <TablaViajes viajes={viajes} onEdit={onEdit} onCancel={onCancel} />
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.06] text-[12px]">
                <span className="text-[#6E7681]">Página {page} de {totalPages}</span>
                <div className="flex items-center gap-1.5">
                  <button className="btn btn-ghost px-2.5 py-1" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={13} /></button>
                  <button className="btn btn-ghost px-2.5 py-1" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight size={13} /></button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

// ── Vista: Futuros (programados a futuro) ────────────────────────────────────

function VistaFuturos({ onEdit, onNuevo, onCancel, empresa }: { onEdit: (v: ViajeProg) => void; onNuevo: () => void; onCancel?: (id: number) => void; empresa: string }) {
  // Traer viajes futuros: desde mañana en adelante
  const manana = new Date(); manana.setDate(manana.getDate() + 1)
  const mananaStr = manana.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
  // 30 días en adelante
  const futuro = new Date(); futuro.setDate(futuro.getDate() + 30)
  const futuroStr = futuro.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

  const { data, isLoading } = useViajesProgramadosHistorico(
    { desde: mananaStr, hasta: futuroStr, pageSize: 200, empresa: empresa || undefined },
    true
  )

  const viajes = useMemo(() => {
    const futuros = data?.data ?? []
    return [...futuros].sort((a, b) => {
      const ta = `${a.fechaInicio}T${a.horaInicio}`
      const tb = `${b.fechaInicio}T${b.horaInicio}`
      return ta.localeCompare(tb)
    })
  }, [data])

  // Contar días únicos con viajes programados
  const diasFuturos = useMemo(() => {
    return new Set(viajes.map(v => v.fechaInicio)).size
  }, [viajes])

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="stat-card">
          <p className="stat-label">Viajes programados</p>
          <p className="stat-value text-blue-400">{viajes.length}</p>
          <p className="stat-sub">próximos 30 días</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Días con viajes</p>
          <p className="stat-value text-amber-400">{diasFuturos}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Desde</p>
          <p className="stat-value text-[14px]">{new Date(mananaStr + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}</p>
          <p className="stat-sub">hasta 30 días</p>
        </div>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="p-8 text-center text-[#6E7681] text-[13px]">Cargando...</div>
        ) : viajes.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-4xl mb-3">📅</p>
            <p className="text-[14px] font-semibold mb-1">Sin viajes programados a futuro</p>
            <p className="text-[13px] text-[#8B949E] mb-4">Programá viajes para los próximos días.</p>
            <button className="btn btn-primary" onClick={onNuevo}><Plus size={13} />Programar viaje</button>
          </div>
        ) : (
          <TablaViajes viajes={viajes} onEdit={onEdit} onCancel={onCancel} />
        )}
      </div>
    </>
  )
}

// ── Página principal ─────────────────────────────────────────────────────────

function CancelModal({ id, onClose }: { id: number; onClose: () => void }) {
  const [motivo, setMotivo] = useState('')
  const cancelar = useCancelarViaje()

  const handleConfirm = () => {
    cancelar.mutate({ id, motivo }, { onSuccess: () => onClose() })
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-[#161B22] border border-white/[0.12] rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
          <h2 className="text-[14px] font-semibold">Cancelar viaje #{id}</h2>
          <button onClick={onClose} className="text-[#6E7681] hover:text-[#E6EDF3] transition-colors"><X size={16} /></button>
        </div>
        <div className="p-5 flex flex-col gap-3">
          <label className="block">
            <span className="text-[11px] text-[#8B949E] mb-1 block">Motivo de cancelacion *</span>
            <textarea
              className="input w-full resize-none"
              rows={3}
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              placeholder="Ingrese el motivo de la cancelacion..."
              autoFocus
            />
          </label>
          {cancelar.isError && <p className="text-[12px] text-red-400 bg-red-500/10 rounded-md px-3 py-2">Error al cancelar el viaje.</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-white/[0.07]">
          <button className="btn btn-ghost" onClick={onClose}>Volver</button>
          <button
            className="btn bg-red-600 hover:bg-red-700 text-white border-0"
            onClick={handleConfirm}
            disabled={!motivo.trim() || cancelar.isPending}
          >
            {cancelar.isPending ? 'Cancelando...' : 'Confirmar cancelacion'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Vista: Planificación (timeline por vehículo) ────────────────────────────

const HORA_INICIO_DIA = 5  // 05:00
const HORA_FIN_DIA = 22     // 22:00
const TOTAL_HORAS = HORA_FIN_DIA - HORA_INICIO_DIA

function horaAMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number)
  return h * 60 + (m || 0)
}

function minutosAHora(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

function calcFinEstimado(v: ViajeProg): number {
  const inicioMin = horaAMinutos(v.horaInicio)
  const enDestino = v.tiempoEnDestinoMin ?? 60
  // Si tiene hora de llegada estimada, sumarle tiempo en destino
  if (v.horaLlegadaEstimada) {
    return horaAMinutos(v.horaLlegadaEstimada) + enDestino
  }
  // Si tiene duración real, sumarle tiempo en destino
  if (v.duracionRealMin) {
    return inicioMin + v.duracionRealMin + enDestino
  }
  // Usar duración estimada estadística (trimmed mean o promedio de rutas históricas)
  if (v.duracionEstimadaMin) {
    return inicioMin + v.duracionEstimadaMin + enDestino
  }
  // Fallback: estimar por distancia (40km/h promedio) + tiempo en destino
  if (v.distanciaEstimadaKm) {
    return inicioMin + Math.round((v.distanciaEstimadaKm / 40) * 60) + enDestino
  }
  return inicioMin + 60 + enDestino // Default 1 hora viaje + destino
}

const ESTADO_COLORES: Record<string, string> = {
  pendiente: '#6E7681',
  en_curso: '#3B82F6',
  cumplido: '#10B981',
  cancelado: '#4B5563',
}

function VistaPlanificacion({ empresa }: { empresa: string }) {
  const todayStr = hoy()
  const [fechaSel, setFechaSel] = useState(todayStr)
  const esHoy = fechaSel === todayStr

  const fmt = (dt: Date) => dt.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
  const moverDia = (n: number) => {
    const d = new Date(fechaSel + 'T12:00:00'); d.setDate(d.getDate() + n)
    const nuevoStr = fmt(d)
    if (nuevoStr < todayStr) return // no permitir ir al pasado (para eso esta Historico)
    setFechaSel(nuevoStr)
  }

  const params: Record<string, string> = { fecha: fechaSel }
  if (empresa) params.empresa = empresa
  const { data, isLoading } = useViajesProgramadosDia(params)
  const viajes = data?.data ?? []
  const { data: todosVehiculos = [] } = useVehiculos({ empresa: empresa || undefined })
  const [detalleAbierto, setDetalleAbierto] = useState<string | null>(null)

  // Agrupar viajes por vehículo
  const vehiculos = useMemo(() => {
    const map = new Map<string, { codigo: string; etiqueta: string; division: string | null; viajes: ViajeProg[] }>()
    for (const v of viajes) {
      if (v.estado === 'cancelado') continue
      const key = v.codigoEquipo ?? v.etiqueta
      if (!map.has(key)) {
        map.set(key, { codigo: key, etiqueta: v.etiqueta, division: v.division, viajes: [] })
      }
      map.get(key)!.viajes.push(v)
    }
    for (const veh of map.values()) {
      veh.viajes.sort((a, b) => a.horaInicio.localeCompare(b.horaInicio))
    }
    return [...map.values()].sort((a, b) => a.codigo.localeCompare(b.codigo))
  }, [viajes])

  // Equipos sin viajes, agrupados por división
  const equiposSinViajes = useMemo(() => {
    const conViajes = new Set(vehiculos.map(v => v.codigo))
    const sinViajes = todosVehiculos.filter((v: any) => !conViajes.has(v.codigo) && v.estado !== 'en_taller')
    // Agrupar por división
    const porDiv = new Map<string, any[]>()
    for (const v of sinViajes) {
      const div = v.division || 'Sin unidad de negocio'
      if (!porDiv.has(div)) porDiv.set(div, [])
      porDiv.get(div)!.push(v)
    }
    return [...porDiv.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [todosVehiculos, vehiculos])

  const calcOcupacion = (viajesVeh: ViajeProg[]): number => {
    const totalMin = TOTAL_HORAS * 60
    let ocupadoMin = 0
    for (const v of viajesVeh) {
      const ini = horaAMinutos(v.horaInicio)
      const fin = calcFinEstimado(v)
      ocupadoMin += Math.max(0, fin - ini)
    }
    return Math.min(100, Math.round((ocupadoMin / totalMin) * 100))
  }

  if (isLoading) return <p className="text-[#6E7681] p-6">Cargando planificación...</p>

  const horas = Array.from({ length: TOTAL_HORAS + 1 }, (_, i) => HORA_INICIO_DIA + i)

  return (
    <div className="flex flex-col gap-5">
      {/* Navegación de fechas */}
      <div className="flex gap-2 flex-wrap items-center">
        <button className="btn btn-ghost p-1.5" onClick={() => moverDia(-1)} disabled={fechaSel <= todayStr}><ChevronLeft size={14} /></button>
        <div className="flex items-center gap-1.5 bg-[#161B22] border border-white/[0.08] rounded-lg px-3 py-1.5">
          <Calendar size={13} className="text-[#6E7681]" />
          <input
            type="date"
            className="bg-transparent text-[12px] text-[#E6EDF3] outline-none w-[140px]"
            value={fechaSel}
            min={todayStr}
            onChange={e => setFechaSel(e.target.value || todayStr)}
          />
        </div>
        <button className="btn btn-ghost p-1.5" onClick={() => moverDia(1)}><ChevronRight size={14} /></button>
        {!esHoy && (
          <button className="btn btn-ghost text-[11px] px-2 py-1" onClick={() => setFechaSel(todayStr)}>
            Hoy
          </button>
        )}
        <span className="text-[11px] text-[#6E7681] ml-2">
          {esHoy ? 'Planificación del día' : 'Planificación futura'}
        </span>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="stat-card"><p className="stat-label">Vehículos programados</p><p className="stat-value text-[#E6EDF3]">{vehiculos.length}</p></div>
        <div className="stat-card"><p className="stat-label">Total viajes</p><p className="stat-value text-blue-400">{viajes.filter(v => v.estado !== 'cancelado').length}</p></div>
        <div className="stat-card"><p className="stat-label">Ocupación promedio</p><p className="stat-value text-amber-400">{vehiculos.length > 0 ? Math.round(vehiculos.reduce((acc, v) => acc + calcOcupacion(v.viajes), 0) / vehiculos.length) : 0}%</p></div>
        <div className="stat-card"><p className="stat-label">Completados</p><p className="stat-value text-emerald-400">{viajes.filter(v => v.estado === 'cumplido').length}</p></div>
        <div className="stat-card"><p className="stat-label">Equipos libres</p><p className="stat-value text-[#8B949E]">{todosVehiculos.length - vehiculos.length}</p></div>
      </div>

      {/* Timeline */}
      {vehiculos.length > 0 && (
        <div className="card p-5">
          <h3 className="text-[13px] font-semibold text-[#E6EDF3] mb-4">
            Planificación del día — {new Date(fechaSel + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </h3>

          {/* Leyenda */}
          <div className="flex gap-4 mb-4 text-[10px]">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: ESTADO_COLORES.pendiente }} />Pendiente</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: ESTADO_COLORES.en_curso }} />En curso</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: ESTADO_COLORES.cumplido }} />Cumplido</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#F59E0B]/30 border border-[#F59E0B]/50" />Tiempo en destino</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#1C2333] border border-white/10" />Libre</span>
          </div>

          <div className="overflow-x-auto">
            <div style={{ minWidth: 900 }}>
              {/* Header de horas */}
              <div className="flex items-end mb-1" style={{ paddingLeft: 140 }}>
                {horas.map(h => (
                  <div key={h} className="text-[9px] text-[#6E7681] text-center" style={{ width: `${100 / TOTAL_HORAS}%`, minWidth: 0 }}>
                    {h.toString().padStart(2, '0')}:00
                  </div>
                ))}
              </div>

              {/* Timeline por vehículo */}
              {vehiculos.map(veh => {
                const ocupacion = calcOcupacion(veh.viajes)
                const isOpen = detalleAbierto === veh.codigo
                return (
                  <div key={veh.codigo}>
                    <div
                      className="flex items-center mb-1 cursor-pointer hover:bg-white/[0.02] rounded transition-colors"
                      onClick={() => setDetalleAbierto(isOpen ? null : veh.codigo)}
                    >
                      <div className="flex-shrink-0 w-[140px] pr-3 text-right">
                        <span className="font-mono font-bold text-[12px] text-[#E6EDF3]">{veh.codigo}</span>
                        <span className="text-[10px] text-[#6E7681] ml-1.5">{ocupacion}%</span>
                      </div>

                      <div className="flex-1 relative h-[32px] bg-[#161B22] rounded border border-white/[0.06] overflow-hidden">
                        {horas.map(h => (
                          <div key={h} className="absolute top-0 bottom-0 border-l border-white/[0.04]" style={{ left: `${((h - HORA_INICIO_DIA) / TOTAL_HORAS) * 100}%` }} />
                        ))}

                        {/* Hora actual (solo si la fecha seleccionada es hoy) */}
                        {esHoy && (() => {
                          const now = new Date()
                          const nowMin = now.getHours() * 60 + now.getMinutes()
                          const dayStartMin = HORA_INICIO_DIA * 60
                          const dayEndMin = HORA_FIN_DIA * 60
                          if (nowMin >= dayStartMin && nowMin <= dayEndMin) {
                            const pct = ((nowMin - dayStartMin) / (dayEndMin - dayStartMin)) * 100
                            return <div className="absolute top-0 bottom-0 w-[2px] bg-red-500 z-20" style={{ left: `${pct}%` }} />
                          }
                          return null
                        })()}

                        {/* Bloques de viaje + tiempo en destino */}
                        {veh.viajes.map(v => {
                          const dayStartMin = HORA_INICIO_DIA * 60
                          const dayTotalMin = TOTAL_HORAS * 60
                          const iniMin = horaAMinutos(v.horaInicio)
                          const finViaje = calcFinEstimado(v) - (v.tiempoEnDestinoMin ?? 60) // fin sin destino
                          const finConDestino = calcFinEstimado(v) // fin con destino
                          const color = ESTADO_COLORES[v.estado] ?? '#6E7681'

                          // Bloque del viaje
                          const leftViaje = Math.max(0, ((iniMin - dayStartMin) / dayTotalMin) * 100)
                          const widthViaje = Math.max(0.5, ((finViaje - iniMin) / dayTotalMin) * 100)

                          // Bloque de tiempo en destino
                          const leftDest = Math.max(0, ((finViaje - dayStartMin) / dayTotalMin) * 100)
                          const widthDest = Math.max(0, ((finConDestino - finViaje) / dayTotalMin) * 100)

                          return (
                            <span key={v.id}>
                              <div
                                className="absolute top-[3px] bottom-[3px] rounded-l-sm flex items-center justify-center overflow-hidden"
                                style={{ left: `${leftViaje}%`, width: `${widthViaje}%`, background: color, opacity: 0.85 }}
                                title={`${v.horaInicio.slice(0, 5)} → ${minutosAHora(finViaje)} viaje | ${v.geocercaOrigenNombre} → ${v.geocercaDestinoNombre} | ${v.carga ?? ''}`}
                              >
                                <span className="text-[8px] text-white font-medium truncate px-0.5 drop-shadow">
                                  {widthViaje > 3 ? `${v.geocercaOrigenNombre?.split(' ')[0]} → ${v.geocercaDestinoNombre?.split(' ')[0]}` : ''}
                                </span>
                              </div>
                              {widthDest > 0 && (
                                <div
                                  className="absolute top-[3px] bottom-[3px] rounded-r-sm"
                                  style={{ left: `${leftDest}%`, width: `${widthDest}%`, background: '#F59E0B', opacity: 0.3 }}
                                  title={`${minutosAHora(finViaje)} → ${minutosAHora(finConDestino)} | ${v.tiempoEnDestinoMin ?? 60} min en destino`}
                                />
                              )}
                            </span>
                          )
                        })}
                      </div>
                    </div>

                    {/* Detalle expandible */}
                    {isOpen && (
                      <div className="ml-[140px] mb-3 bg-[#161B22] rounded-lg p-3 border border-white/[0.06]">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="font-mono font-bold text-[13px]">{veh.codigo}</span>
                          <span className="text-[10px] text-[#6E7681]">{veh.viajes.length} viaje{veh.viajes.length > 1 ? 's' : ''}</span>
                          <span className="text-[10px] text-amber-400">{ocupacion}% ocupación</span>
                        </div>
                        <div className="grid gap-1.5">
                          {veh.viajes.map((v, i) => {
                            const finViaje = calcFinEstimado(v) - (v.tiempoEnDestinoMin ?? 60)
                            const finTotal = calcFinEstimado(v)
                            let libreAntes = 0
                            if (i === 0) {
                              libreAntes = horaAMinutos(v.horaInicio) - HORA_INICIO_DIA * 60
                            } else {
                              libreAntes = horaAMinutos(v.horaInicio) - calcFinEstimado(veh.viajes[i - 1])
                            }

                            return (
                              <div key={v.id}>
                                {libreAntes > 15 && (
                                  <div className="text-[9px] text-emerald-400/70 bg-emerald-400/10 px-2 py-0.5 rounded mb-1 inline-block">
                                    {libreAntes} min libre
                                  </div>
                                )}
                                <div className="flex items-center gap-2 text-[11px]">
                                  <span className="w-[5px] h-[5px] rounded-full flex-shrink-0" style={{ background: ESTADO_COLORES[v.estado] }} />
                                  <span className="text-[#8B949E] font-mono w-[110px]">
                                    {v.horaInicio.slice(0, 5)} → {minutosAHora(finTotal)}
                                  </span>
                                  <span className="text-[#E6EDF3] truncate flex-1">
                                    {v.geocercaOrigenNombre} → {v.geocercaDestinoNombre}
                                  </span>
                                  <span className="text-[#6E7681] text-[10px]">{v.carga ?? ''}</span>
                                  <span className="text-[10px] text-amber-400/70">{v.tiempoEnDestinoMin ?? 60}' dest</span>
                                </div>
                              </div>
                            )
                          })}
                          {/* Libre al final */}
                          {(() => {
                            const ultimo = veh.viajes[veh.viajes.length - 1]
                            const finUltimo = calcFinEstimado(ultimo)
                            const libreDesp = HORA_FIN_DIA * 60 - finUltimo
                            if (libreDesp > 30) {
                              return (
                                <div className="text-[10px] text-emerald-400/60 mt-1 ml-2">
                                  Libre desde {minutosAHora(finUltimo)} ({Math.floor(libreDesp / 60)}h {libreDesp % 60}min disponible)
                                </div>
                              )
                            }
                            return null
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

        </div>
      )}

      {vehiculos.length === 0 && (
        <div className="card p-6 text-center text-[#6E7681]">
          No hay viajes programados para {esHoy ? 'hoy' : new Date(fechaSel + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </div>
      )}

      {/* Equipos sin viajes — formato tarjetas tipo geocercas (solo hoy) */}
      {esHoy && equiposSinViajes.length > 0 && (
        <>
          <p className="text-[11px] text-[#6E7681] uppercase tracking-wide">Equipos sin viajes programados hoy</p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {equiposSinViajes.map(([division, eqs]) => (
              <div key={division} className="card p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="font-semibold text-[14px] text-[#E6EDF3] uppercase">{division}</h4>
                  </div>
                  <span className={`badge ${divisionClass(division)}`}>{division}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {eqs.map((eq: any) => (
                    <span key={eq.codigo} className="text-[10px] font-mono bg-[#21273A] text-[#8B949E] px-2 py-1 rounded border border-white/[0.06]">
                      {eq.codigo}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-3 text-center pt-3 border-t border-white/[0.07]">
                  <div>
                    <p className="text-[18px] font-bold text-emerald-400">{eqs.length}</p>
                    <p className="text-[10px] text-[#6E7681]">Disponibles</p>
                  </div>
                  <div>
                    <p className="text-[18px] font-bold text-blue-400">{eqs.filter((e: any) => e.estado === 'en_ruta').length}</p>
                    <p className="text-[10px] text-[#6E7681]">En ruta</p>
                  </div>
                  <div>
                    <p className="text-[18px] font-bold text-[#6E7681]">{eqs.filter((e: any) => e.estado === 'inactivo').length}</p>
                    <p className="text-[10px] text-[#6E7681]">Inactivos</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default function ViajesProgramados() {
  const { isAdmin } = useAuth()
  const { empresa } = useEmpresa()
  const [tab, setTab] = useState('hoy')
  const [showModal, setShowModal] = useState(false)
  const [editViaje, setEditViaje] = useState<ViajeProg | null>(null)
  const [cancelModalId, setCancelModalId] = useState<number | null>(null)

  const todayStr = hoy()
  const hoyParams: Record<string, string> = { fecha: todayStr, incluirEnCurso: 'true' }
  if (empresa) hoyParams.empresa = empresa
  const { data: dataHoy } = useViajesProgramadosDia(hoyParams)
  const resumenHoy = dataHoy?.resumen

  const handleEdit = (v: ViajeProg) => setEditViaje(v)
  const handleNuevo = () => setShowModal(true)
  const handleCancel = isAdmin ? (id: number) => setCancelModalId(id) : undefined

  return (
    <div className="p-5 flex flex-col gap-5">
      {(showModal || editViaje) && (
        <ViajeModal editando={editViaje} onClose={() => { setShowModal(false); setEditViaje(null) }} />
      )}
      {cancelModalId !== null && (
        <CancelModal id={cancelModalId} onClose={() => setCancelModalId(null)} />
      )}

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Viajes programados</h1>
          <p className="text-[13px] text-[#8B949E] mt-0.5">Planificado vs real · comparacion automatica con viajes GPS</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <Tabs
            tabs={[
              { key: 'hoy',           label: 'En curso',      count: resumenHoy?.total },
              { key: 'planificacion', label: 'Planificación' },
              { key: 'historico',     label: 'Historico' },
              { key: 'futuros',       label: 'Futuros' },
            ]}
            active={tab}
            onChange={setTab}
          />
          <button className="btn btn-primary" onClick={handleNuevo}>
            <Plus size={13} />{tab === 'futuros' ? 'Programar viaje' : 'Nuevo viaje'}
          </button>
        </div>
      </div>

      {tab === 'hoy'           && <VistaHoy onEdit={handleEdit} onNuevo={handleNuevo} onCancel={handleCancel} empresa={empresa} />}
      {tab === 'planificacion' && <VistaPlanificacion empresa={empresa} />}
      {tab === 'historico'     && <VistaHistorico onEdit={handleEdit} onCancel={handleCancel} empresa={empresa} />}
      {tab === 'futuros'       && <VistaFuturos onEdit={handleEdit} onNuevo={handleNuevo} onCancel={handleCancel} empresa={empresa} />}
    </div>
  )
}
