import { useState, useMemo } from 'react'
import {
  useResumenDivision, useVehiculos, useViajesLibres,
  useViajesLibresHistorico, useInformeVehiculos, useInformeChoferes,
  useDivisionesValidas, useLiquidacion, divisionClass, formatDuracion, formatTS,
} from '../hooks/hooks'
import { useEmpresa } from '../components/layout/Layout'
import type { ViajeLibre } from '../api/api'
import { AlertTriangle, ChevronDown, ChevronRight, ArrowRight, Calendar, Truck, User, DollarSign } from 'lucide-react'

function hoy() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }) }

// ── Tab selector ─────────────────────────────────────────────────────────────

function Tabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className="flex gap-1 bg-[#161B22] border border-white/[0.07] rounded-lg p-0.5">
      {tabs.map(t => (
        <button
          key={t}
          className={`px-3.5 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
            active === t ? 'bg-brand text-white' : 'text-[#8B949E] hover:text-[#E6EDF3]'
          }`}
          onClick={() => onChange(t)}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

// ── Informe: Resumen del día ─────────────────────────────────────────────────

function InformeDia() {
  const { empresa } = useEmpresa()
  const empresaParam = empresa || undefined
  const { data: vehiculos = [] } = useVehiculos({ empresa: empresaParam })
  const { data: viajes }         = useViajesLibres({ empresa: empresaParam })
  const { data: resumen }        = useResumenDivision({ empresa: empresaParam })

  const enRuta    = vehiculos.filter(v => v.estado === 'en_ruta').length
  const detenido  = vehiculos.filter(v => v.estado === 'detenido_encendido').length
  const inactivo  = vehiculos.filter(v => v.estado === 'inactivo').length
  const conGeo    = vehiculos.filter(v => v.geocercaActual).length

  const todosViajes = [
    ...(viajes?.enCurso ?? []),
    ...(viajes?.completados ?? []),
  ]

  // Agrupar viajes por equipo
  const porEquipo = todosViajes.reduce<Record<string, { viajes: number; km: number; chofer: string | null; division: string | null }>>((acc, v) => {
    const key = v.etiqueta ?? v.patente ?? v.codigoEquipo ?? '?'
    if (!acc[key]) acc[key] = { viajes: 0, km: 0, chofer: v.chofer, division: v.division }
    acc[key].viajes++
    acc[key].km += v.kmRecorridos ?? 0
    return acc
  }, {})

  const filas = Object.entries(porEquipo).sort((a, b) => b[1].viajes - a[1].viajes)

  return (
    <>
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="stat-card"><p className="stat-label">Equipos totales</p><p className="stat-value text-blue-400">{vehiculos.length}</p></div>
        <div className="stat-card"><p className="stat-label">En ruta</p><p className="stat-value text-emerald-400">{enRuta}</p></div>
        <div className="stat-card"><p className="stat-label">Detenidos</p><p className="stat-value text-amber-400">{detenido}</p></div>
        <div className="stat-card"><p className="stat-label">Inactivos</p><p className="stat-value">{inactivo}</p></div>
        <div className="stat-card"><p className="stat-label">En geocercas</p><p className="stat-value text-blue-400">{conGeo}</p></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Viajes del día por equipo */}
        <div className="card">
          <div className="card-header justify-between">
            <span className="card-title">Viajes del día por equipo</span>
            <span className="text-[11px] text-[#6E7681]">{todosViajes.length} viajes</span>
          </div>
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            {filas.length === 0 ? (
              <div className="p-8 text-center text-[#6E7681] text-[13px]">Sin viajes detectados hoy</div>
            ) : (
              <table className="tbl">
                <thead><tr><th>Equipo</th><th>Chofer</th><th>Unidad de negocio</th><th>Viajes</th><th>Km</th></tr></thead>
                <tbody>
                  {filas.map(([eq, d]) => (
                    <tr key={eq}>
                      <td className="font-semibold">{eq}</td>
                      <td className="text-[#8B949E]">{d.chofer ?? '—'}</td>
                      <td>{d.division ? <span className={`badge ${divisionClass(d.division)}`}>{d.division}</span> : <span className="text-[#6E7681]">—</span>}</td>
                      <td className="font-bold text-blue-400">{d.viajes}</td>
                      <td className="text-[#8B949E]">{d.km > 0 ? `${d.km.toFixed(1)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Por división */}
        <div className="card">
          <div className="card-header"><span className="card-title">Equipos por unidad de negocio</span></div>
          <div className="p-4 flex flex-col gap-4">
            {resumen && Object.keys(resumen).length > 0
              ? Object.entries(resumen).map(([div, data]) => {
                  const max   = Math.max(...Object.values(resumen).map(d => d.total), 1)
                  const pct   = Math.round((data.total / max) * 100)
                  const colors: Record<string, string> = {
                    'Hormigón':'#06B6D4','Agregados':'#F59E0B','Premoldeados':'#8B5CF6',
                    'Obras':'#10B981','Logística':'#60A5FA','Corralón':'#F87171','Taller':'#9CA3AF',
                  }
                  const color = colors[div] ?? '#9CA3AF'
                  return (
                    <div key={div}>
                      <div className="flex justify-between text-[12px] mb-1.5">
                        <span className="font-semibold" style={{ color }}>{div}</span>
                        <span className="text-[#8B949E]">{data.total} equipos · {data.en_ruta} en ruta</span>
                      </div>
                      <div className="pbar"><div className="pbar-fill" style={{ width: `${pct}%`, background: color }} /></div>
                      {Object.keys(data.subgrupos).length > 0 && (
                        <div className="pl-3 border-l border-white/[0.07] mt-2 flex flex-col gap-1">
                          {Object.entries(data.subgrupos).map(([sub, n]) => (
                            <p key={sub} className="text-[11px] text-[#6E7681]">↳ {sub} ({n as number} equipos)</p>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })
              : <div className="text-center text-[#6E7681] text-[13px] py-4">
                  Sin unidades de negocio asignadas — asigná en la pantalla Equipos (✎)
                </div>
            }
          </div>
        </div>
      </div>
    </>
  )
}

// ── Informe: Equipos sin reportar ────────────────────────────────────────────

function InformeSinReportar() {
  const { empresa } = useEmpresa()
  const { data: vehiculos = [], isLoading } = useVehiculos({ empresa: empresa || undefined })

  const ahora = Date.now()
  const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000

  const sinReportar = useMemo(() => {
    return vehiculos
      .map(v => {
        const ultima = v.ultimaActualizacion ? new Date(v.ultimaActualizacion).getTime() : 0
        const diasSinReportar = ultima > 0 ? Math.floor((ahora - ultima) / (24 * 60 * 60 * 1000)) : null
        return { ...v, diasSinReportar, ultimaMs: ultima }
      })
      .filter(v => v.ultimaMs === 0 || (ahora - v.ultimaMs) >= SIETE_DIAS_MS)
      .sort((a, b) => (a.ultimaMs || 0) - (b.ultimaMs || 0))
  }, [vehiculos, ahora])

  // Agrupar por rango de días
  const rangos = useMemo(() => {
    const r = { nunca: 0, mas30: 0, entre15y30: 0, entre7y15: 0 }
    for (const v of sinReportar) {
      if (!v.diasSinReportar) r.nunca++
      else if (v.diasSinReportar >= 30) r.mas30++
      else if (v.diasSinReportar >= 15) r.entre15y30++
      else r.entre7y15++
    }
    return r
  }, [sinReportar])

  return (
    <>
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat-card">
          <p className="stat-label">Sin reportar (+7 días)</p>
          <p className="stat-value text-red-400">{sinReportar.length}</p>
          <p className="stat-sub">de {vehiculos.length} equipos</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">+30 días sin señal</p>
          <p className="stat-value text-red-400">{rangos.mas30}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">15-30 días</p>
          <p className="stat-value text-amber-400">{rangos.entre15y30}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">7-15 días</p>
          <p className="stat-value text-[#E6EDF3]">{rangos.entre7y15}</p>
        </div>
      </div>

      {sinReportar.length > 0 && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3.5 py-2.5 text-[12px] text-red-300">
          <AlertTriangle size={14} />
          {sinReportar.length} equipos no reportan hace más de 7 días. Verificar estado del GPS.
        </div>
      )}

      <div className="card">
        <div className="card-header justify-between">
          <span className="card-title">Equipos sin reporte reciente</span>
          <span className="text-[11px] text-[#6E7681]">{sinReportar.length} equipos</span>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-[#6E7681] text-[13px]">Cargando...</div>
        ) : sinReportar.length === 0 ? (
          <div className="p-8 text-center text-[#6E7681] text-[13px]">
            Todos los equipos reportaron en los últimos 7 días
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Equipo</th>
                  <th>Grupo RedGPS</th>
                  <th>Unidad de negocio</th>
                  <th>Último reporte</th>
                  <th>Días sin señal</th>
                  <th>Última posición</th>
                  <th>Mapa</th>
                </tr>
              </thead>
              <tbody>
                {sinReportar.map(v => (
                  <tr key={v.id}>
                    <td>
                      <p className="font-semibold">{v.etiqueta}</p>
                      <p className="text-[10px] text-[#6E7681]">{v.codigo !== v.etiqueta ? v.codigo : ''} {[v.marca, v.modelo].filter(Boolean).join(' ')}</p>
                    </td>
                    <td className="text-[11px] text-[#8B949E]">{(v as any).grupoRedGps || '—'}</td>
                    <td>{v.division ? <span className={`badge ${divisionClass(v.division)}`}>{v.division}</span> : <span className="text-[#6E7681]">—</span>}</td>
                    <td className="text-[#8B949E]">
                      {v.ultimaActualizacion
                        ? new Date(v.ultimaActualizacion).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
                        : 'Nunca'}
                    </td>
                    <td>
                      <span className={`font-bold ${
                        !v.diasSinReportar ? 'text-red-400' :
                        v.diasSinReportar >= 30 ? 'text-red-400' :
                        v.diasSinReportar >= 15 ? 'text-amber-400' : 'text-[#E6EDF3]'
                      }`}>
                        {v.diasSinReportar ? `${v.diasSinReportar} días` : 'Sin datos'}
                      </span>
                    </td>
                    <td className="text-[11px] text-[#6E7681]">
                      {v.latitud && v.longitud ? `${v.latitud.toFixed(4)}, ${v.longitud.toFixed(4)}` : '—'}
                    </td>
                    <td>
                      {v.latitud && v.longitud ? (
                        <a
                          href={`https://www.google.com/maps?q=${v.latitud},${v.longitud}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 text-[11px]"
                        >
                          Ver
                        </a>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

// ── Informe: Histórico ───────────────────────────────────────────────────────

function InformeHistorico() {
  const todayStr = hoy()
  const [desde, setDesde] = useState(todayStr)
  const [hasta, setHasta] = useState(todayStr)
  const [filtDiv, setFiltDiv] = useState('')
  const [filtEquipo, setFiltEquipo] = useState('')

  const { data: hist, isLoading } = useViajesLibresHistorico({
    desde, hasta,
    division: filtDiv || undefined,
    codigoEquipo: filtEquipo || undefined,
    pageSize: 500,
  }, true)

  const viajes = hist?.data ?? []

  const porEquipo = viajes.reduce<Record<string, { viajes: number; km: number; chofer: string | null; division: string | null }>>((acc, v) => {
    const key = v.etiqueta ?? v.patente ?? '?'
    if (!acc[key]) acc[key] = { viajes: 0, km: 0, chofer: v.chofer, division: v.division }
    acc[key].viajes++
    acc[key].km += v.kmRecorridos ?? 0
    return acc
  }, {})

  const filas = Object.entries(porEquipo).sort((a, b) => b[1].viajes - a[1].viajes)

  return (
    <>
      <div className="flex gap-2 flex-wrap items-center">
        <input type="date" className="input" value={desde} max={hasta} onChange={e => setDesde(e.target.value)} />
        <span className="text-[#6E7681] text-xs">→</span>
        <input type="date" className="input" value={hasta} min={desde} max={todayStr} onChange={e => setHasta(e.target.value)} />
        <input
          className="input w-32"
          placeholder="Equipo..."
          value={filtEquipo}
          onChange={e => setFiltEquipo(e.target.value.toUpperCase())}
        />
        <select className="input" value={filtDiv} onChange={e => setFiltDiv(e.target.value)}>
          <option value="">Todas las unidades de negocio</option>
          <option>Hormigón</option><option>Agregados</option><option>Premoldeados</option>
          <option>Obras</option><option>Logística</option><option>Corralón</option><option>Taller</option>
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="stat-card"><p className="stat-label">Total viajes</p><p className="stat-value text-blue-400">{viajes.length}</p></div>
        <div className="stat-card"><p className="stat-label">Equipos activos</p><p className="stat-value">{filas.length}</p></div>
        <div className="stat-card"><p className="stat-label">Km totales</p><p className="stat-value">{viajes.reduce((s, v) => s + (v.kmRecorridos ?? 0), 0).toFixed(1)}</p></div>
      </div>

      <div className="card">
        <div className="card-header justify-between">
          <span className="card-title">Viajes históricos por equipo</span>
          <span className="text-[11px] text-[#6E7681]">{hist?.source === 'mysql' ? 'MySQL' : 'Memoria'}</span>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-[#6E7681] text-[13px]">Cargando...</div>
        ) : filas.length === 0 ? (
          <div className="p-8 text-center text-[#6E7681] text-[13px]">Sin datos para el período seleccionado</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Equipo</th><th>Chofer</th><th>Unidad de negocio</th><th>Viajes</th><th>Km</th></tr></thead>
              <tbody>
                {filas.map(([eq, d]) => (
                  <tr key={eq}>
                    <td className="font-semibold">{eq}</td>
                    <td className="text-[#8B949E]">{d.chofer ?? '—'}</td>
                    <td>{d.division ? <span className={`badge ${divisionClass(d.division)}`}>{d.division}</span> : <span className="text-[#6E7681]">—</span>}</td>
                    <td className="font-bold text-blue-400">{d.viajes}</td>
                    <td className="text-[#8B949E]">{d.km > 0 ? `${d.km.toFixed(1)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

// ── Informe: Rutas entre geocercas ───────────────────────────────────────────

interface RutaAgrupada {
  origen: string
  destino: string
  clave: string
  cantidad: number
  kmTotal: number
  duracionTotal: number
  viajes: ViajeLibre[]
}

function InformeRutas() {
  const { empresa } = useEmpresa()
  const empresaParam = empresa || undefined
  const todayStr = hoy()

  const [modo, setModo] = useState<'hoy' | 'historico'>('hoy')
  const [desde, setDesde] = useState(todayStr)
  const [hasta, setHasta] = useState(todayStr)
  const [filtDiv, setFiltDiv] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  // Datos del dia actual
  const { data: viajesDia } = useViajesLibres({ empresa: empresaParam })

  // Datos historicos
  const { data: hist, isLoading: loadingHist } = useViajesLibresHistorico(
    { desde, hasta, pageSize: 1000 },
    modo === 'historico'
  )

  // Unificar viajes segun el modo
  const viajesSinFiltro: ViajeLibre[] = useMemo(() => {
    if (modo === 'hoy') {
      return [
        ...(viajesDia?.completados ?? []),
        ...(viajesDia?.enCurso ?? []),
      ]
    }
    return hist?.data ?? []
  }, [modo, viajesDia, hist])

  // Divisiones disponibles (extraidas de los viajes)
  const divisionesDisponibles = useMemo(() => {
    const set = new Set<string>()
    for (const v of viajesSinFiltro) {
      if (v.division) set.add(v.division)
    }
    return [...set].sort()
  }, [viajesSinFiltro])

  // Aplicar filtro de division
  const viajes = useMemo(() => {
    if (!filtDiv) return viajesSinFiltro
    return viajesSinFiltro.filter(v => v.division === filtDiv)
  }, [viajesSinFiltro, filtDiv])

  // Agrupar por ruta Origen → Destino
  const rutas: RutaAgrupada[] = useMemo(() => {
    const mapa = new Map<string, RutaAgrupada>()

    for (const v of viajes) {
      const origen  = v.geocercaOrigen?.nombre  || '(Sin origen)'
      const destino = v.geocercaDestino?.nombre || '(En transito)'
      const clave   = `${origen}→${destino}`

      if (!mapa.has(clave)) {
        mapa.set(clave, {
          origen,
          destino,
          clave,
          cantidad: 0,
          kmTotal: 0,
          duracionTotal: 0,
          viajes: [],
        })
      }

      const ruta = mapa.get(clave)!
      ruta.cantidad++
      ruta.kmTotal       += v.kmRecorridos ?? 0
      ruta.duracionTotal += v.duracionMin  ?? 0
      ruta.viajes.push(v)
    }

    return [...mapa.values()].sort((a, b) => b.cantidad - a.cantidad)
  }, [viajes])

  // Stats
  const totalViajes = viajes.length
  const totalRutas  = rutas.length
  const rutaMasFrecuente = rutas[0]

  const isLoading = modo === 'historico' ? loadingHist : false

  return (
    <>
      {/* Controles */}
      <div className="flex gap-2 flex-wrap items-center">
        <div className="flex gap-1 bg-[#161B22] border border-white/[0.07] rounded-lg p-0.5">
          <button
            className={`px-3.5 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
              modo === 'hoy' ? 'bg-brand text-white' : 'text-[#8B949E] hover:text-[#E6EDF3]'
            }`}
            onClick={() => setModo('hoy')}
          >
            Hoy
          </button>
          <button
            className={`px-3.5 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
              modo === 'historico' ? 'bg-brand text-white' : 'text-[#8B949E] hover:text-[#E6EDF3]'
            }`}
            onClick={() => setModo('historico')}
          >
            Historico
          </button>
        </div>

        {modo === 'historico' && (
          <div className="flex items-center gap-1.5 bg-[#161B22] border border-white/[0.08] rounded-lg px-3 py-1.5">
            <Calendar size={13} className="text-[#6E7681]" />
            <input
              type="date"
              className="bg-transparent text-[12px] text-[#E6EDF3] outline-none w-[110px]"
              value={desde}
              max={hasta}
              onChange={e => setDesde(e.target.value)}
            />
            <span className="text-[#6E7681] text-[11px]">→</span>
            <input
              type="date"
              className="bg-transparent text-[12px] text-[#E6EDF3] outline-none w-[110px]"
              value={hasta}
              min={desde}
              max={todayStr}
              onChange={e => setHasta(e.target.value)}
            />
          </div>
        )}

        <select
          className="input"
          value={filtDiv}
          onChange={e => setFiltDiv(e.target.value)}
        >
          <option value="">Todas las unidades de negocio</option>
          {divisionesDisponibles.map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat-card">
          <p className="stat-label">Total viajes</p>
          <p className="stat-value text-blue-400">{totalViajes}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Rutas distintas</p>
          <p className="stat-value text-emerald-400">{totalRutas}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Ruta mas frecuente</p>
          <p className="stat-value text-amber-400">{rutaMasFrecuente?.cantidad ?? 0}</p>
          {rutaMasFrecuente && (
            <p className="stat-sub truncate">{rutaMasFrecuente.origen} → {rutaMasFrecuente.destino}</p>
          )}
        </div>
        <div className="stat-card">
          <p className="stat-label">Km totales</p>
          <p className="stat-value">{viajes.reduce((s, v) => s + (v.kmRecorridos ?? 0), 0).toFixed(1)}</p>
        </div>
      </div>

      {/* Tabla de rutas */}
      <div className="card">
        <div className="card-header justify-between">
          <span className="card-title">Viajes por ruta (Origen → Destino)</span>
          <span className="text-[11px] text-[#6E7681]">
            {modo === 'hoy' ? 'Datos del dia' : `${desde} al ${hasta}`}
          </span>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-[#6E7681] text-[13px]">Cargando...</div>
        ) : rutas.length === 0 ? (
          <div className="p-8 text-center text-[#6E7681] text-[13px]">
            Sin viajes detectados {modo === 'hoy' ? 'hoy' : 'en el periodo seleccionado'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 30 }}></th>
                  <th>Origen</th>
                  <th></th>
                  <th>Destino</th>
                  <th>Viajes</th>
                  <th>Duracion prom.</th>
                  <th>Km total</th>
                </tr>
              </thead>
              <tbody>
                {rutas.map(ruta => {
                  const isOpen = expanded === ruta.clave
                  const durProm = ruta.cantidad > 0 ? Math.round(ruta.duracionTotal / ruta.cantidad) : 0

                  return (
                    <>
                      {/* Fila principal de la ruta */}
                      <tr
                        key={ruta.clave}
                        className="cursor-pointer hover:bg-white/[0.04] transition-colors"
                        onClick={() => setExpanded(isOpen ? null : ruta.clave)}
                      >
                        <td className="text-center">
                          {isOpen
                            ? <ChevronDown size={14} className="text-blue-400 inline" />
                            : <ChevronRight size={14} className="text-[#6E7681] inline" />
                          }
                        </td>
                        <td>
                          <span className="font-semibold text-[#E6EDF3]">{ruta.origen}</span>
                        </td>
                        <td className="text-center">
                          <ArrowRight size={14} className="text-[#6E7681] inline" />
                        </td>
                        <td>
                          <span className="font-semibold text-[#E6EDF3]">{ruta.destino}</span>
                        </td>
                        <td>
                          <span className="font-bold text-blue-400 text-[14px]">{ruta.cantidad}</span>
                        </td>
                        <td className="text-amber-400 font-semibold">{formatDuracion(durProm)}</td>
                        <td className="text-[#8B949E]">{ruta.kmTotal > 0 ? `${ruta.kmTotal.toFixed(1)} km` : '—'}</td>
                      </tr>

                      {/* Detalle expandible: viajes de esta ruta */}
                      {isOpen && (
                        <tr key={`${ruta.clave}-detail`}>
                          <td colSpan={7} className="!p-0">
                            <div className="bg-[#0D1117] border-y border-white/[0.06]">
                              <table className="tbl w-full">
                                <thead>
                                  <tr className="!bg-[#0D1117]">
                                    <th className="!text-[10px] pl-10">Equipo</th>
                                    <th className="!text-[10px]">Chofer</th>
                                    <th className="!text-[10px]">Unidad de negocio</th>
                                    <th className="!text-[10px]">Inicio</th>
                                    <th className="!text-[10px]">Fin</th>
                                    <th className="!text-[10px]">Duracion</th>
                                    <th className="!text-[10px]">Km</th>
                                    <th className="!text-[10px]">Estado</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {ruta.viajes
                                    .sort((a, b) => (b.timestampInicio ?? '').localeCompare(a.timestampInicio ?? ''))
                                    .map(v => (
                                    <tr key={v.id} className="!bg-[#0D1117] hover:!bg-white/[0.03]">
                                      <td className="pl-10">
                                        <span className="font-mono font-semibold text-[12px]">
                                          {v.codigoEquipo ?? v.etiqueta ?? v.patente ?? '—'}
                                        </span>
                                        {v.patente && v.patente !== v.codigoEquipo && (
                                          <span className="text-[10px] text-[#6E7681] ml-1.5">{v.patente}</span>
                                        )}
                                      </td>
                                      <td>
                                        {v.chofer
                                          ? <div className="drv-chip"><div className="drv-av">{v.chofer.slice(0,2).toUpperCase()}</div>{v.chofer}</div>
                                          : <span className="text-[#6E7681]">—</span>
                                        }
                                      </td>
                                      <td>
                                        {v.division
                                          ? <span className={`badge ${divisionClass(v.division)}`}>{v.division}</span>
                                          : <span className="text-[#6E7681]">—</span>
                                        }
                                      </td>
                                      <td className="text-[#6E7681] text-[11px]">
                                        {v.timestampInicio
                                          ? new Date(v.timestampInicio).toLocaleString('es-AR', {
                                              day: '2-digit', month: '2-digit',
                                              hour: '2-digit', minute: '2-digit',
                                            })
                                          : '—'}
                                      </td>
                                      <td className="text-[#6E7681] text-[11px]">
                                        {v.timestampFin
                                          ? new Date(v.timestampFin).toLocaleString('es-AR', {
                                              day: '2-digit', month: '2-digit',
                                              hour: '2-digit', minute: '2-digit',
                                            })
                                          : '—'}
                                      </td>
                                      <td className="text-amber-400 font-semibold">{formatDuracion(v.duracionMin)}</td>
                                      <td className="text-[#8B949E]">{v.kmRecorridos != null ? `${v.kmRecorridos} km` : '—'}</td>
                                      <td>
                                        <span className={`badge ${
                                          v.estado === 'completado' ? 'badge-green' :
                                          v.estado === 'en_curso'   ? 'badge-blue'  : 'badge-gray'
                                        }`}>
                                          {v.estado === 'completado' ? 'Completado' : v.estado === 'en_curso' ? 'En curso' : 'Transito'}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

// ── Informe: Liquidación ────────────────────────────────────────────────────

function InformeLiquidacion() {
  const { empresa } = useEmpresa()
  const empresaParam = empresa || undefined

  const [periodo, setPeriodo] = useState<'30dias' | 'mes' | 'custom'>('30dias')
  const [division, setDivision] = useState('')
  const [choferFilter, setChoferFilter] = useState('')
  const [expandido, setExpandido] = useState<string | null>(null)
  const [desdeCustom, setDesdeCustom] = useState('')
  const [hastaCustom, setHastaCustom] = useState(hoy())

  const { data: divConfig } = useDivisionesValidas(empresaParam)
  const divisiones = divConfig?.divisiones ?? []

  const desde = periodo === '30dias' ? fechaHace30Dias()
              : periodo === 'mes'    ? primerDiaMes()
              : desdeCustom
  const hasta = periodo === 'custom' ? hastaCustom : hoy()
  const enabled = periodo !== 'custom' || (!!desdeCustom && !!hastaCustom)

  const { data: liq, isLoading } = useLiquidacion(
    { desde, hasta, division: division || undefined, chofer: choferFilter || undefined, empresa: empresaParam },
    enabled
  )

  const agrupados = liq?.data ?? []
  const totalViajes = liq?.totalViajes ?? 0
  const totalKm = liq?.totalKm ?? 0
  const totalPrecio = liq?.totalPrecio ?? 0
  const sinTarifa = liq?.viajesSinTarifa ?? 0

  const formatPrecio = (n: number | null) => {
    if (n == null) return '—'
    return `$${n.toLocaleString('es-AR')}`
  }

  return (
    <>
      {/* Controles */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-[#161B22] border border-white/[0.07] rounded-lg p-0.5">
          {(['30dias', 'mes', 'custom'] as const).map(p => (
            <button key={p}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                periodo === p ? 'bg-[#30363D] text-white' : 'text-[#8B949E] hover:text-[#E6EDF3]'
              }`}
              onClick={() => setPeriodo(p)}
            >
              {p === '30dias' ? '30 días' : p === 'mes' ? 'Mes' : 'Personalizado'}
            </button>
          ))}
        </div>

        {periodo === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={desdeCustom} onChange={e => setDesdeCustom(e.target.value)}
              className="bg-[#0D1117] border border-white/[0.07] rounded px-2 py-1 text-[12px] text-[#E6EDF3]" />
            <span className="text-[#6E7681] text-[11px]">a</span>
            <input type="date" value={hastaCustom} onChange={e => setHastaCustom(e.target.value)}
              className="bg-[#0D1117] border border-white/[0.07] rounded px-2 py-1 text-[12px] text-[#E6EDF3]" />
          </div>
        )}

        <select value={division} onChange={e => setDivision(e.target.value)}
          className="bg-[#0D1117] border border-white/[0.07] rounded px-2.5 py-1.5 text-[12px] text-[#E6EDF3]">
          <option value="">Todas las unidades de negocio</option>
          {divisiones.map(d => <option key={d} value={d}>{d}</option>)}
        </select>

        <input
          type="text"
          placeholder="Filtrar chofer..."
          value={choferFilter}
          onChange={e => setChoferFilter(e.target.value)}
          className="bg-[#0D1117] border border-white/[0.07] rounded px-2.5 py-1.5 text-[12px] text-[#E6EDF3] w-48"
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-[#161B22] rounded-lg p-3.5 border border-white/[0.07]">
          <p className="text-[11px] text-[#6E7681] uppercase tracking-wider mb-1">Choferes</p>
          <p className="text-2xl font-bold">{agrupados.length}</p>
        </div>
        <div className="bg-[#161B22] rounded-lg p-3.5 border border-white/[0.07]">
          <p className="text-[11px] text-[#6E7681] uppercase tracking-wider mb-1">Total viajes</p>
          <p className="text-2xl font-bold text-green-400">{totalViajes}</p>
        </div>
        <div className="bg-[#161B22] rounded-lg p-3.5 border border-white/[0.07]">
          <p className="text-[11px] text-[#6E7681] uppercase tracking-wider mb-1">Km totales</p>
          <p className="text-2xl font-bold text-blue-400">{Math.round(totalKm).toLocaleString()}</p>
        </div>
        <div className="bg-[#161B22] rounded-lg p-3.5 border border-white/[0.07]">
          <p className="text-[11px] text-[#6E7681] uppercase tracking-wider mb-1">Total combustible</p>
          <p className="text-2xl font-bold text-amber-400">{formatPrecio(totalPrecio)}</p>
        </div>
        <div className="bg-[#161B22] rounded-lg p-3.5 border border-white/[0.07]">
          <p className="text-[11px] text-[#6E7681] uppercase tracking-wider mb-1">Sin tarifa</p>
          <p className={`text-2xl font-bold ${sinTarifa > 0 ? 'text-red-400' : 'text-green-400'}`}>{sinTarifa}</p>
        </div>
      </div>

      {/* Tabla */}
      {isLoading ? (
        <p className="text-[#6E7681] text-[13px]">Cargando...</p>
      ) : agrupados.length === 0 ? (
        <p className="text-[#6E7681] text-[13px]">Sin datos para el período seleccionado</p>
      ) : (
        <div className="flex flex-col gap-3">
          {agrupados.map(grupo => {
            const abierto = expandido === grupo.chofer
            const iniciales = grupo.chofer.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
            return (
              <div key={grupo.chofer} className="bg-[#161B22] rounded-lg border border-white/[0.07] overflow-hidden">
                {/* Header del chofer */}
                <button
                  className="w-full flex items-center gap-3 p-3.5 hover:bg-white/[0.02] transition-colors text-left"
                  onClick={() => setExpandido(abierto ? null : grupo.chofer)}
                >
                  {abierto ? <ChevronDown size={14} className="text-[#6E7681]" /> : <ChevronRight size={14} className="text-[#6E7681]" />}
                  <span className="w-7 h-7 rounded-full bg-brand/20 text-brand flex items-center justify-center text-[11px] font-bold flex-shrink-0">
                    {iniciales}
                  </span>
                  <span className="font-medium text-[13px] flex-1">{grupo.chofer}</span>
                  <span className="text-[12px] text-green-400 font-semibold mr-4">{grupo.totalViajes} viajes</span>
                  <span className="text-[12px] text-blue-400 mr-4">{Math.round(grupo.totalKm)} km</span>
                  <span className="text-[12px] text-amber-400 font-bold">{formatPrecio(grupo.totalPrecio)}</span>
                </button>

                {/* Detalle de viajes */}
                {abierto && (
                  <div className="border-t border-white/[0.07]">
                    <div className="overflow-x-auto">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="text-left text-[#6E7681] text-[10px] uppercase tracking-wider bg-[#0D1117]/40">
                            <th className="p-2 pl-3">Fecha</th>
                            <th className="p-2">Equipo</th>
                            <th className="p-2">Patente</th>
                            <th className="p-2">Unidad de negocio</th>
                            <th className="p-2">Origen</th>
                            <th className="p-2">Destino</th>
                            <th className="p-2 text-center">Duración</th>
                            <th className="p-2 text-center">Km</th>
                            <th className="p-2 text-right pr-3">Precio</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.04]">
                          {grupo.viajes.map(v => (
                            <tr key={v.id} className="hover:bg-white/[0.02]">
                              <td className="p-2 pl-3 text-[#8B949E]">
                                {v.timestampInicio
                                  ? new Date(v.timestampInicio).toLocaleDateString('es-AR', {
                                      day: '2-digit', month: '2-digit', year: '2-digit',
                                    })
                                  : '—'}
                              </td>
                              <td className="p-2 font-medium text-[#E6EDF3]">{v.codigoEquipo || '—'}</td>
                              <td className="p-2 text-[#8B949E]">{v.patente || '—'}</td>
                              <td className="p-2">
                                {v.division && <span className={`badge text-[10px] ${divisionClass(v.division)}`}>{v.division}</span>}
                              </td>
                              <td className="p-2 text-[#E6EDF3]">{v.origen}</td>
                              <td className="p-2 text-[#E6EDF3]">{v.destino}</td>
                              <td className="p-2 text-center text-amber-400">{formatDuracion(v.duracionMin)}</td>
                              <td className="p-2 text-center text-blue-400">{v.kmRecorridos != null ? v.kmRecorridos : '—'}</td>
                              <td className={`p-2 text-right pr-3 font-semibold ${v.precio != null ? 'text-green-400' : 'text-red-400/60'}`}>
                                {v.precio != null ? formatPrecio(v.precio) : 'Sin tarifa'}
                              </td>
                            </tr>
                          ))}
                          {/* Fila total */}
                          <tr className="bg-[#0D1117]/60 font-semibold">
                            <td className="p-2 pl-3" colSpan={6}>
                              <span className="text-[#8B949E]">Total {grupo.chofer}</span>
                            </td>
                            <td className="p-2 text-center text-amber-400">
                              {formatDuracion(grupo.viajes.reduce((s, v) => s + (v.duracionMin || 0), 0))}
                            </td>
                            <td className="p-2 text-center text-blue-400">{Math.round(grupo.totalKm)}</td>
                            <td className="p-2 text-right pr-3 text-green-400">{formatPrecio(grupo.totalPrecio)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

// ── Informe: Rendimiento ────────────────────────────────────────────────────

function fechaHace30Dias() {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
}

function primerDiaMes() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function InformeRendimiento() {
  const { empresa } = useEmpresa()
  const empresaParam = empresa || undefined

  const [subTab, setSubTab] = useState<'vehiculos' | 'choferes'>('vehiculos')
  const [periodo, setPeriodo] = useState<'30dias' | 'mes' | 'custom'>('30dias')
  const [division, setDivision] = useState('')
  const [desdeCustom, setDesdeCustom] = useState('')
  const [hastaCustom, setHastaCustom] = useState(hoy())

  const { data: divConfig } = useDivisionesValidas(empresaParam)
  const divisiones = divConfig?.divisiones ?? []

  const desde = periodo === '30dias' ? fechaHace30Dias()
              : periodo === 'mes'    ? primerDiaMes()
              : desdeCustom
  const hasta = periodo === 'custom' ? hastaCustom : hoy()

  const queryParams = { desde, hasta, division: division || undefined, empresa: empresaParam }
  const enabled = periodo !== 'custom' || (!!desdeCustom && !!hastaCustom)

  const { data: vehiculos = [], isLoading: loadingV } = useInformeVehiculos(queryParams, enabled && subTab === 'vehiculos')
  const { data: choferes = [], isLoading: loadingC }  = useInformeChoferes(queryParams, enabled && subTab === 'choferes')

  // Totales
  const totalesV = useMemo(() => ({
    viajes: vehiculos.reduce((s, v) => s + v.totalViajes, 0),
    km:     vehiculos.reduce((s, v) => s + v.totalKm, 0),
    equipos: vehiculos.length,
  }), [vehiculos])

  const totalesC = useMemo(() => ({
    viajes:   choferes.reduce((s, c) => s + c.totalViajes, 0),
    km:       choferes.reduce((s, c) => s + c.totalKm, 0),
    choferes: choferes.length,
  }), [choferes])

  const periodoLabel = periodo === '30dias' ? 'Últimos 30 días'
                     : periodo === 'mes'    ? 'Mes en curso'
                     : `${desdeCustom || '?'} a ${hastaCustom || '?'}`

  return (
    <>
      {/* Controles */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Sub-tabs vehiculos / choferes */}
        <div className="flex gap-1 bg-[#161B22] border border-white/[0.07] rounded-lg p-0.5">
          <button
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
              subTab === 'vehiculos' ? 'bg-brand text-white' : 'text-[#8B949E] hover:text-[#E6EDF3]'
            }`}
            onClick={() => setSubTab('vehiculos')}
          >
            <Truck size={13} /> Vehículos
          </button>
          <button
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
              subTab === 'choferes' ? 'bg-brand text-white' : 'text-[#8B949E] hover:text-[#E6EDF3]'
            }`}
            onClick={() => setSubTab('choferes')}
          >
            <User size={13} /> Choferes
          </button>
        </div>

        {/* Periodo */}
        <div className="flex gap-1 bg-[#161B22] border border-white/[0.07] rounded-lg p-0.5">
          {(['30dias', 'mes', 'custom'] as const).map(p => (
            <button
              key={p}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                periodo === p ? 'bg-[#30363D] text-white' : 'text-[#8B949E] hover:text-[#E6EDF3]'
              }`}
              onClick={() => setPeriodo(p)}
            >
              {p === '30dias' ? '30 días' : p === 'mes' ? 'Mes' : 'Personalizado'}
            </button>
          ))}
        </div>

        {periodo === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={desdeCustom} onChange={e => setDesdeCustom(e.target.value)}
              className="bg-[#0D1117] border border-white/[0.07] rounded px-2 py-1 text-[12px] text-[#E6EDF3]" />
            <span className="text-[#6E7681] text-[11px]">a</span>
            <input type="date" value={hastaCustom} onChange={e => setHastaCustom(e.target.value)}
              className="bg-[#0D1117] border border-white/[0.07] rounded px-2 py-1 text-[12px] text-[#E6EDF3]" />
          </div>
        )}

        {/* Division filter */}
        <select
          value={division}
          onChange={e => setDivision(e.target.value)}
          className="bg-[#0D1117] border border-white/[0.07] rounded px-2.5 py-1.5 text-[12px] text-[#E6EDF3]"
        >
          <option value="">Todas las unidades de negocio</option>
          {divisiones.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-[#161B22] rounded-lg p-3.5 border border-white/[0.07]">
          <p className="text-[11px] text-[#6E7681] uppercase tracking-wider mb-1">
            {subTab === 'vehiculos' ? 'Equipos activos' : 'Choferes activos'}
          </p>
          <p className="text-2xl font-bold">
            {subTab === 'vehiculos' ? totalesV.equipos : totalesC.choferes}
          </p>
        </div>
        <div className="bg-[#161B22] rounded-lg p-3.5 border border-white/[0.07]">
          <p className="text-[11px] text-[#6E7681] uppercase tracking-wider mb-1">Total viajes</p>
          <p className="text-2xl font-bold text-green-400">
            {subTab === 'vehiculos' ? totalesV.viajes : totalesC.viajes}
          </p>
        </div>
        <div className="bg-[#161B22] rounded-lg p-3.5 border border-white/[0.07]">
          <p className="text-[11px] text-[#6E7681] uppercase tracking-wider mb-1">Km totales</p>
          <p className="text-2xl font-bold text-blue-400">
            {Math.round(subTab === 'vehiculos' ? totalesV.km : totalesC.km).toLocaleString()}
          </p>
        </div>
        <div className="bg-[#161B22] rounded-lg p-3.5 border border-white/[0.07]">
          <p className="text-[11px] text-[#6E7681] uppercase tracking-wider mb-1">Período</p>
          <p className="text-sm font-medium text-amber-400">{periodoLabel}</p>
        </div>
      </div>

      {/* Tabla de vehiculos */}
      {subTab === 'vehiculos' && (
        <div className="bg-[#161B22] rounded-lg border border-white/[0.07] overflow-hidden">
          <div className="p-3.5 border-b border-white/[0.07] flex items-center gap-2">
            <Truck size={15} className="text-brand" />
            <span className="font-medium text-[13px]">Rendimiento por vehículo</span>
            <span className="text-[11px] text-[#6E7681] ml-auto">{vehiculos.length} equipos</span>
          </div>
          {loadingV ? (
            <p className="p-4 text-[#6E7681] text-[13px]">Cargando...</p>
          ) : vehiculos.length === 0 ? (
            <p className="p-4 text-[#6E7681] text-[13px]">Sin datos para el período seleccionado</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[#6E7681] text-[11px] uppercase tracking-wider bg-[#0D1117]/40">
                    <th className="p-2.5">Equipo</th>
                    <th className="p-2.5">Unidad de negocio</th>
                    <th className="p-2.5 text-center">Viajes</th>
                    <th className="p-2.5 text-center">Km total</th>
                    <th className="p-2.5 text-center">Km prom.</th>
                    <th className="p-2.5 text-center">Tiempo total</th>
                    <th className="p-2.5 text-center">Dur. prom.</th>
                    <th className="p-2.5 text-center">Días activo</th>
                    <th className="p-2.5 text-center">Viajes/día</th>
                    <th className="p-2.5 text-center">Km/día</th>
                    <th className="p-2.5">Choferes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {vehiculos.map((v, i) => (
                    <tr key={v.codigo || i} className="hover:bg-white/[0.02]">
                      <td className="p-2.5">
                        <div className="font-medium text-[#E6EDF3]">{v.patente || v.codigo}</div>
                        {v.patente && v.codigo && (
                          <div className="text-[10px] text-[#6E7681]">{v.codigo}</div>
                        )}
                      </td>
                      <td className="p-2.5">
                        {v.division && <span className={`badge ${divisionClass(v.division)}`}>{v.division}</span>}
                      </td>
                      <td className="p-2.5 text-center font-semibold text-green-400">{v.totalViajes}</td>
                      <td className="p-2.5 text-center text-blue-400">{v.totalKm.toLocaleString()}</td>
                      <td className="p-2.5 text-center text-[#8B949E]">{v.promedioKm}</td>
                      <td className="p-2.5 text-center text-amber-400">{formatDuracion(v.totalMinutos)}</td>
                      <td className="p-2.5 text-center text-[#8B949E]">{formatDuracion(v.promedioDuracion)}</td>
                      <td className="p-2.5 text-center">{v.diasActivo}</td>
                      <td className="p-2.5 text-center font-medium">
                        <span className={v.viajesPorDia >= 3 ? 'text-green-400' : v.viajesPorDia >= 1 ? 'text-amber-400' : 'text-red-400'}>
                          {v.viajesPorDia}
                        </span>
                      </td>
                      <td className="p-2.5 text-center text-[#8B949E]">{v.kmPorDia}</td>
                      <td className="p-2.5 text-[11px] text-[#8B949E] max-w-[150px] truncate" title={v.choferes}>
                        {v.choferesDistintos > 0 ? `${v.choferesDistintos} chofer${v.choferesDistintos > 1 ? 'es' : ''}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tabla de choferes */}
      {subTab === 'choferes' && (
        <div className="bg-[#161B22] rounded-lg border border-white/[0.07] overflow-hidden">
          <div className="p-3.5 border-b border-white/[0.07] flex items-center gap-2">
            <User size={15} className="text-brand" />
            <span className="font-medium text-[13px]">Rendimiento por chofer</span>
            <span className="text-[11px] text-[#6E7681] ml-auto">{choferes.length} choferes</span>
          </div>
          {loadingC ? (
            <p className="p-4 text-[#6E7681] text-[13px]">Cargando...</p>
          ) : choferes.length === 0 ? (
            <p className="p-4 text-[#6E7681] text-[13px]">Sin datos para el período seleccionado</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[#6E7681] text-[11px] uppercase tracking-wider bg-[#0D1117]/40">
                    <th className="p-2.5">Chofer</th>
                    <th className="p-2.5">Unidades de negocio</th>
                    <th className="p-2.5 text-center">Viajes</th>
                    <th className="p-2.5 text-center">Km total</th>
                    <th className="p-2.5 text-center">Km prom.</th>
                    <th className="p-2.5 text-center">Tiempo total</th>
                    <th className="p-2.5 text-center">Dur. prom.</th>
                    <th className="p-2.5 text-center">Días activo</th>
                    <th className="p-2.5 text-center">Viajes/día</th>
                    <th className="p-2.5 text-center">Km/día</th>
                    <th className="p-2.5 text-center">Vehículos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {choferes.map((c, i) => {
                    const iniciales = c.chofer.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
                    return (
                      <tr key={c.chofer || i} className="hover:bg-white/[0.02]">
                        <td className="p-2.5">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-brand/20 text-brand flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                              {iniciales}
                            </span>
                            <span className="font-medium text-[#E6EDF3] truncate max-w-[160px]" title={c.chofer}>
                              {c.chofer}
                            </span>
                          </div>
                        </td>
                        <td className="p-2.5">
                          <div className="flex gap-1 flex-wrap">
                            {c.divisiones.split(', ').filter(Boolean).map(d => (
                              <span key={d} className={`badge text-[10px] ${divisionClass(d)}`}>{d}</span>
                            ))}
                          </div>
                        </td>
                        <td className="p-2.5 text-center font-semibold text-green-400">{c.totalViajes}</td>
                        <td className="p-2.5 text-center text-blue-400">{c.totalKm.toLocaleString()}</td>
                        <td className="p-2.5 text-center text-[#8B949E]">{c.promedioKm}</td>
                        <td className="p-2.5 text-center text-amber-400">{formatDuracion(c.totalMinutos)}</td>
                        <td className="p-2.5 text-center text-[#8B949E]">{formatDuracion(c.promedioDuracion)}</td>
                        <td className="p-2.5 text-center">{c.diasActivo}</td>
                        <td className="p-2.5 text-center font-medium">
                          <span className={c.viajesPorDia >= 3 ? 'text-green-400' : c.viajesPorDia >= 1 ? 'text-amber-400' : 'text-red-400'}>
                            {c.viajesPorDia}
                          </span>
                        </td>
                        <td className="p-2.5 text-center text-[#8B949E]">{c.kmPorDia}</td>
                        <td className="p-2.5 text-center">
                          <span className="text-[#8B949E]" title={c.vehiculos}>
                            {c.vehiculosDistintos}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  )
}

// ── Pagina principal ─────────────────────────────────────────────────────────

export default function Informes() {
  const [tab, setTab] = useState('Resumen del dia')

  return (
    <div className="p-5 flex flex-col gap-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Informes</h1>
          <p className="text-[13px] text-[#8B949E] mt-0.5">
            {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <Tabs
          tabs={['Resumen del dia', 'Rutas', 'Liquidacion', 'Rendimiento', 'Sin reportar', 'Historico']}
          active={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'Resumen del dia' && <InformeDia />}
      {tab === 'Rutas'           && <InformeRutas />}
      {tab === 'Liquidacion'     && <InformeLiquidacion />}
      {tab === 'Rendimiento'     && <InformeRendimiento />}
      {tab === 'Sin reportar'    && <InformeSinReportar />}
      {tab === 'Historico'       && <InformeHistorico />}
    </div>
  )
}
