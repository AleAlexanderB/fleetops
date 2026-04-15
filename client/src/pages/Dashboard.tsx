import { useQuery } from '@tanstack/react-query'
import { useVehiculos, useResumenDivision, useViajesLibres, usePosicionesSSE, useAlertasResumen, formatDuracion, formatTS, divisionClass, estadoBadgeClass, estadoLabel } from '../hooks/hooks'
import { useEmpresa } from '../components/layout/Layout'
import { http } from '../api/api'
import { Truck, MapPin, Navigation, AlertTriangle, Route } from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────────────────

function hoy() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
}

const fmtKm = (n: number) => {
  const s = n.toFixed(2)
  return s.replace(/\.?0+$/, '')
}

function StatCard({ label, value, sub, color = '' }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="stat-card">
      <p className="stat-label">{label}</p>
      <p className={`stat-value ${color}`}>{value}</p>
      {sub && <p className="stat-sub">{sub}</p>}
    </div>
  )
}

const DIV_COLORS: Record<string, string> = {
  'Hormigon':     'border-teal-500 text-teal-400',
  'Agregados':    'border-amber-500 text-amber-400',
  'Premoldeados': 'border-purple-500 text-purple-400',
  'Obras':        'border-emerald-500 text-emerald-400',
  'Logistica':    'border-blue-400 text-blue-400',
  'Corralon':     'border-red-400 text-red-400',
  'Taller':       'border-gray-500 text-gray-400',
}

export default function Dashboard() {
  const { empresa } = useEmpresa()
  const empresaParam = empresa || undefined

  const { data: vehiculos = [], isLoading: vLoad }  = useVehiculos({ empresa: empresaParam })
  const { data: resumen,        isLoading: rLoad }  = useResumenDivision({ empresa: empresaParam })
  const { data: viajes,         isLoading: vjLoad } = useViajesLibres({ empresa: empresaParam })
  const { posiciones, conectado }                   = usePosicionesSSE()
  const { data: alertasData }                       = useAlertasResumen({ empresa: empresaParam })

  // Viajes programados
  const { data: progData } = useQuery({
    queryKey: ['viajes-prog-dashboard', hoy()],
    queryFn: () => http.get('/viajes/programados', { params: { fecha: hoy() } }).then(r => r.data),
    refetchInterval: 30_000,
    staleTime: 25_000,
  })
  const progResumen = progData?.resumen
  const progViajes = progData?.data ?? []

  // Filtrar posiciones SSE por empresa si hay filtro activo
  const posicionesFilt = empresa
    ? posiciones.filter(p => p.empresa === empresa)
    : posiciones

  const enRuta       = vehiculos.filter(v => v.estado === 'en_ruta').length
  const enCurso      = (viajes?.resumen.enCurso ?? 0)
  const alertasCount = alertasData?.noLeidas ?? 0
  const geocercasActivas = new Set(vehiculos.filter(v => v.geocercaActual).map(v => v.geocercaActual)).size
  const kmHoy        = fmtKm(viajes?.resumen.kmTotal ?? 0)

  const ultimosViajes = [
    ...(viajes?.enCurso     ?? []),
    ...(viajes?.completados ?? []),
  ].slice(0, 6)

  // ── Rendimiento del dia: top choferes y equipos ─────────────────────────────
  const todosViajes = [
    ...(viajes?.completados ?? []),
    ...(viajes?.enCurso     ?? []),
  ]

  // Top choferes
  const choferMap = new Map<string, { chofer: string; division: string | null; viajes: number; km: number }>()
  for (const v of todosViajes) {
    const name = v.chofer ?? 'Sin chofer'
    const prev = choferMap.get(name)
    if (prev) {
      prev.viajes++
      prev.km += v.kmRecorridos ?? 0
    } else {
      choferMap.set(name, { chofer: name, division: v.division ?? null, viajes: 1, km: v.kmRecorridos ?? 0 })
    }
  }
  const topChoferes = [...choferMap.values()].sort((a, b) => b.viajes - a.viajes).slice(0, 5)

  // Top equipos
  const equipoMap = new Map<string, { codigo: string; patente: string | null; division: string | null; viajes: number; km: number }>()
  for (const v of todosViajes) {
    const code = v.codigoEquipo ?? v.etiqueta ?? v.patente ?? '?'
    const prev = equipoMap.get(code)
    if (prev) {
      prev.viajes++
      prev.km += v.kmRecorridos ?? 0
    } else {
      equipoMap.set(code, { codigo: code, patente: v.patente ?? null, division: v.division ?? null, viajes: 1, km: v.kmRecorridos ?? 0 })
    }
  }
  const topEquipos = [...equipoMap.values()].sort((a, b) => b.viajes - a.viajes).slice(0, 5)

  // ── Equipos sin movimiento ──────────────────────────────────────────────────
  const sinMovimiento = vehiculos
    .filter(v => v.estado === 'inactivo' || v.estado === 'detenido_encendido')
    .sort((a, b) => {
      const ta = a.ultimaActualizacion ? new Date(a.ultimaActualizacion).getTime() : 0
      const tb = b.ultimaActualizacion ? new Date(b.ultimaActualizacion).getTime() : 0
      return ta - tb
    })
    .slice(0, 5)

  // Initials helper
  const initials = (name: string) => {
    const parts = name.split(' ').filter(Boolean)
    if (parts.length === 0) return '??'
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase()
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }

  return (
    <div className="p-5 flex flex-col gap-5">

      {/* Titulo */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-[13px] text-[#8B949E] mt-0.5">
            {empresa
              ? <><span className="text-blue-400">{empresa}</span> · </>
              : null}
            {new Date().toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}
          </p>
        </div>
        <div className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border ${conectado ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' : 'border-amber-500/30 text-amber-400 bg-amber-500/10'}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${conectado ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
          {conectado ? `SSE · ${posicionesFilt.length} unidades` : 'SSE · reconectando'}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <StatCard label="Equipos en ruta"      value={vLoad ? '—' : enRuta}               color="text-emerald-400" sub={`de ${vehiculos.length} activos`} />
        <StatCard label="Viajes libres"        value={vjLoad ? '—' : (viajes?.resumen.total ?? 0)} color="text-blue-400" />
        <StatCard label="Viajes programados"   value={progResumen ? progResumen.total : '—'} color="text-indigo-400" />
        <StatCard label="En curso"             value={vjLoad ? '—' : enCurso}              color="text-amber-400" />
        <StatCard label="Alertas activas"      value={alertasCount}                         color={alertasCount > 0 ? 'text-red-400' : 'text-[#E6EDF3]'} />
        <StatCard label="Geocercas activas"    value={vLoad ? '—' : geocercasActivas}      color="text-cyan-400" />
        <StatCard label="Km totales hoy"       value={vjLoad ? '—' : kmHoy}                color="text-[#E6EDF3]" />
      </div>

      {/* Division summary */}
      {resumen && (
        <div className="card">
          <div className="card-header justify-between">
            <span className="card-title">Equipos por division</span>
            <span className="text-[11px] text-[#6E7681]">en tiempo real</span>
          </div>
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {Object.entries(resumen).map(([div, data]) => {
              const colorClass = DIV_COLORS[div] ?? 'border-gray-500 text-gray-400'
              return (
                <div key={div} className={`bg-[#1C2333] rounded-lg p-3 border-l-2 ${colorClass.split(' ')[0]}`}>
                  <p className={`text-[10px] font-bold mb-1.5 ${colorClass.split(' ')[1]}`}>{div.toUpperCase()}</p>
                  <p className={`text-2xl font-bold ${colorClass.split(' ')[1]}`}>{data.total}</p>
                  <p className="text-[10px] text-[#6E7681] mt-1">
                    {data.en_ruta} en ruta · {data.alerta > 0 ? `${data.alerta} alerta` : `${data.detenido + data.inactivo} parados`}
                  </p>
                  {Object.keys(data.subgrupos).length > 0 && (
                    <div className="mt-1.5 border-t border-white/[0.07] pt-1.5">
                      {Object.entries(data.subgrupos).map(([sub, n]) => (
                        <p key={sub} className="text-[9px] text-[#6E7681]">↳ {sub} ({n})</p>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Grid: ultimas posiciones + ultimos viajes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Posiciones en tiempo real (SSE) */}
        <div className="card">
          <div className="card-header justify-between">
            <span className="card-title">Posiciones en tiempo real</span>
            <span className="badge badge-green text-[9px]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {posicionesFilt.length} unidades
            </span>
          </div>
          <div className="overflow-auto max-h-[280px]">
            {posicionesFilt.length === 0 ? (
              <div className="p-6 text-center text-[12px] text-[#6E7681]">
                {conectado ? 'Esperando posiciones...' : 'Conectando con el servidor...'}
              </div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr><th>Equipo</th><th>Vel.</th><th>Geocerca</th><th>Chofer</th><th>Hora</th></tr>
                </thead>
                <tbody>
                  {posicionesFilt.slice(0, 12).map(p => (
                    <tr key={p.unitPlate ?? p.idgps ?? String(Math.random())}>
                      <td className="font-semibold">{p.etiqueta ?? p.unitPlate ?? p.idgps ?? "—"}</td>
                      <td>
                        <span className={p.velocidad > 100 ? 'text-red-400 font-bold' : p.velocidad > 0 ? 'text-emerald-400' : 'text-[#6E7681]'}>
                          {p.velocidad} km/h
                        </span>
                      </td>
                      <td className="text-[#8B949E]">{p.geocerca ?? '—'}</td>
                      <td className="text-[#8B949E]">{p.conductor ?? '—'}</td>
                      <td className="text-[#6E7681]">{formatTS(p.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Ultimos viajes libres */}
        <div className="card">
          <div className="card-header justify-between">
            <span className="card-title">Últimos viajes libres</span>
          </div>
          <div>
            {ultimosViajes.length === 0 ? (
              <div className="p-6 text-center text-[12px] text-[#6E7681]">Sin viajes detectados hoy</div>
            ) : ultimosViajes.map(v => (
              <div key={v.id} className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.07] last:border-0 hover:bg-[#1C2333] transition-colors">
                <Route size={14} className="text-[#6E7681] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold truncate">
                    {v.geocercaOrigen?.nombre ?? '?'} → {v.geocercaDestino?.nombre ?? '?'}
                  </p>
                  <p className="text-[11px] text-[#8B949E] mt-0.5 flex items-center gap-1.5">
                    {v.etiqueta ?? v.patente ?? "—"}
                    {v.chofer && <span className="text-[#6E7681]">· {v.chofer}</span>}
                    {v.division && <span className={`badge ${divisionClass(v.division)} text-[9px]`}>{v.division}{v.subgrupo ? ` · ${v.subgrupo}` : ''}</span>}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[13px] font-bold text-amber-400">{formatDuracion(v.duracionMin)}</p>
                  <span className={`badge ${v.estado === 'completado' ? 'badge-green' : v.estado === 'en_curso' ? 'badge-blue' : 'badge-gray'} text-[9px]`}>
                    {v.estado === 'completado' ? 'Completado' : v.estado === 'en_curso' ? 'En curso' : 'Transito'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Rendimiento del dia */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Top choferes hoy */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Top choferes hoy</span>
          </div>
          <div>
            {topChoferes.length === 0 ? (
              <div className="p-6 text-center text-[12px] text-[#6E7681]">Sin datos de choferes hoy</div>
            ) : topChoferes.map((c, i) => (
              <div key={c.chofer} className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.07] last:border-0 hover:bg-[#1C2333] transition-colors">
                <div className="w-8 h-8 rounded-full bg-[#1C2333] border border-white/[0.07] flex items-center justify-center text-[11px] font-bold text-[#8B949E] shrink-0">
                  {initials(c.chofer)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold truncate">{c.chofer}</p>
                  {c.division && (
                    <span className={`badge ${divisionClass(c.division)} text-[9px] mt-0.5`}>{c.division}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[12px] font-bold text-emerald-400">{c.viajes} viajes</span>
                  <span className="text-[12px] font-bold text-blue-400">{fmtKm(c.km)} km</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top equipos hoy */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Top equipos hoy</span>
          </div>
          <div>
            {topEquipos.length === 0 ? (
              <div className="p-6 text-center text-[12px] text-[#6E7681]">Sin datos de equipos hoy</div>
            ) : topEquipos.map((e, i) => (
              <div key={e.codigo} className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.07] last:border-0 hover:bg-[#1C2333] transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold">{e.codigo}</p>
                  {e.patente && <p className="text-[10px] text-[#6E7681]">{e.patente}</p>}
                  {e.division && (
                    <span className={`badge ${divisionClass(e.division)} text-[9px] mt-0.5`}>{e.division}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[12px] font-bold text-emerald-400">{e.viajes} viajes</span>
                  <span className="text-[12px] font-bold text-blue-400">{fmtKm(e.km)} km</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Equipos sin movimiento */}
      {sinMovimiento.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Equipos sin movimiento</span>
          </div>
          <div className="overflow-auto">
            <table className="tbl">
              <thead>
                <tr><th>Equipo</th><th>Patente</th><th>Division</th><th>Estado</th><th>Ultima actualizacion</th></tr>
              </thead>
              <tbody>
                {sinMovimiento.map(v => (
                  <tr key={v.id}>
                    <td className="font-semibold">{v.codigoEquipo ?? v.etiqueta ?? '—'}</td>
                    <td className="text-[#8B949E]">{v.patente ?? '—'}</td>
                    <td>
                      {v.division
                        ? <span className={`badge ${divisionClass(v.division)} text-[9px]`}>{v.division}</span>
                        : <span className="text-[#6E7681]">—</span>}
                    </td>
                    <td>
                      <span className={`badge ${estadoBadgeClass(v.estado)} text-[9px]`}>{estadoLabel(v.estado)}</span>
                    </td>
                    <td className="text-[#6E7681]">{formatTS(v.ultimaActualizacion)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Viajes programados — resumen */}
      {progResumen && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Viajes programados — resumen</span>
          </div>
          <div className="p-4 flex flex-wrap gap-3">
            <div className="flex items-center gap-2 bg-[#1C2333] rounded-lg px-3 py-2 border border-white/[0.07]">
              <span className="text-[11px] text-[#8B949E]">Total</span>
              <span className="text-[14px] font-bold text-[#E6EDF3]">{progResumen.total ?? 0}</span>
            </div>
            <div className="flex items-center gap-2 bg-[#1C2333] rounded-lg px-3 py-2 border border-white/[0.07]">
              <span className="text-[11px] text-[#8B949E]">Pendientes</span>
              <span className="text-[14px] font-bold text-amber-400">{progResumen.pendientes ?? 0}</span>
            </div>
            <div className="flex items-center gap-2 bg-[#1C2333] rounded-lg px-3 py-2 border border-white/[0.07]">
              <span className="text-[11px] text-[#8B949E]">En curso</span>
              <span className="text-[14px] font-bold text-blue-400">{progResumen.en_curso ?? 0}</span>
            </div>
            <div className="flex items-center gap-2 bg-[#1C2333] rounded-lg px-3 py-2 border border-white/[0.07]">
              <span className="text-[11px] text-[#8B949E]">Cumplidos</span>
              <span className="text-[14px] font-bold text-emerald-400">{progResumen.cumplidos ?? 0}</span>
            </div>
            <div className="flex items-center gap-2 bg-[#1C2333] rounded-lg px-3 py-2 border border-white/[0.07]">
              <span className="text-[11px] text-[#8B949E]">Retrasados</span>
              <span className="text-[14px] font-bold text-orange-400">{progResumen.retrasados ?? 0}</span>
            </div>
            <div className="flex items-center gap-2 bg-[#1C2333] rounded-lg px-3 py-2 border border-white/[0.07]">
              <span className="text-[11px] text-[#8B949E]">Cancelados</span>
              <span className="text-[14px] font-bold text-red-400">{progResumen.cancelados ?? 0}</span>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
