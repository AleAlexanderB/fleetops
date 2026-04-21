import { useState, useMemo } from 'react'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  useViajesLibres,
  useViajesLibresHistorico,
  useDivisionesValidas,
  formatDuracion,
  formatTS,
  divisionClass,
} from '../hooks/hooks'
import { useEmpresa } from '../components/layout/Layout'
import type { ViajeLibre } from '../api/api'
import ColumnFilter, { useColumnFilters, uniqueValues } from '../components/ColumnFilter'

// ── Helpers ───────────────────────────────────────────────────────────────────

function hoy() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
}

function formatFecha(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

// ── Sub-componente: selector de rango de fechas ───────────────────────────────

interface RangoFechasProps {
  desde: string
  hasta: string
  onChange: (desde: string, hasta: string) => void
}

function RangoFechas({ desde, hasta, onChange }: RangoFechasProps) {
  const todayStr = hoy()

  const irAHoy = () => onChange(todayStr, todayStr)

  const fmt = (dt: Date) => dt.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
  const moverDias = (n: number) => {
    const d = new Date(desde + 'T12:00:00')
    const h = new Date(hasta + 'T12:00:00')
    d.setDate(d.getDate() + n)
    h.setDate(h.getDate() + n)
    onChange(fmt(d), fmt(h))
  }

  const esHoy = desde === todayStr && hasta === todayStr

  return (
    <div className="flex items-center gap-1.5">
      <button
        className="btn btn-ghost p-1.5"
        onClick={() => moverDias(-1)}
        title="Día anterior"
      >
        <ChevronLeft size={14} />
      </button>

      <div className="flex items-center gap-1.5 bg-[#161B22] border border-white/[0.08] rounded-lg px-3 py-1.5">
        <Calendar size={13} className="text-[#6E7681]" />
        <input
          type="date"
          className="bg-transparent text-[12px] text-[#E6EDF3] outline-none w-[110px]"
          value={desde}
          max={hasta}
          onChange={e => onChange(e.target.value, hasta)}
        />
        <span className="text-[#6E7681] text-[11px]">→</span>
        <input
          type="date"
          className="bg-transparent text-[12px] text-[#E6EDF3] outline-none w-[110px]"
          value={hasta}
          min={desde}
          max={todayStr}
          onChange={e => onChange(desde, e.target.value)}
        />
      </div>

      <button
        className="btn btn-ghost p-1.5"
        onClick={() => moverDias(1)}
        disabled={hasta >= todayStr}
        title="Día siguiente"
      >
        <ChevronRight size={14} />
      </button>

      {!esHoy && (
        <button className="btn btn-ghost text-[11px] px-2.5 py-1" onClick={irAHoy}>
          Hoy
        </button>
      )}
    </div>
  )
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function ViajesLibres() {
  const todayStr = hoy()
  const { empresa } = useEmpresa()

  const [desde,   setDesde]   = useState(todayStr)
  const [hasta,   setHasta]   = useState(todayStr)
  const [divisionFiltro, setDivisionFiltro] = useState('')
  const [filters, setFilter, clearFilters, hasFilters] = useColumnFilters([
    'equipo', 'chofer', 'division', 'subgrupo', 'origen', 'destino', 'estado'
  ])
  const [page,    setPage]    = useState(1)

  const { data: divConfig } = useDivisionesValidas(empresa || undefined)

  const esHoy        = desde === todayStr && hasta === todayStr
  const pageSize     = 50

  // Dia actual → memoria (instantaneo, se refresca cada 30s)
  const { data: dataDia, isLoading: loadingDia } = useViajesLibres({ empresa: empresa || undefined })

  // Historico → MySQL (solo cuando no es hoy)
  const { data: dataHist, isLoading: loadingHist } = useViajesLibresHistorico(
    { desde, hasta, page, pageSize },
    !esHoy
  )

  const isLoading = esHoy ? loadingDia : loadingHist

  // Column-filter helper
  const applyFilters = (list: ViajeLibre[]) => list.filter(v => {
    if (divisionFiltro && (v.division || '') !== divisionFiltro) return false
    if (filters.equipo.size > 0 && !filters.equipo.has(v.codigoEquipo ?? v.etiqueta ?? v.patente ?? '—')) return false
    if (filters.chofer.size > 0 && !filters.chofer.has(v.chofer || 'Sin chofer')) return false
    if (filters.division.size > 0 && !filters.division.has(v.division || '—')) return false
    if (filters.subgrupo.size > 0 && !filters.subgrupo.has(v.subgrupo || '—')) return false
    if (filters.origen.size > 0 && !filters.origen.has(v.geocercaOrigen?.nombre || '—')) return false
    if (filters.destino.size > 0 && !filters.destino.has(v.geocercaDestino?.nombre || '—')) return false
    if (filters.estado.size > 0) {
      const label = v.estado === 'completado' ? 'Completado' : v.estado === 'en_curso' ? 'En curso' : 'Tránsito'
      if (!filters.estado.has(label)) return false
    }
    return true
  })

  // Unificar datos según modo
  const { allViajes, viajes, resumen, totalPages } = useMemo(() => {
    if (esHoy) {
      const all = [
        ...(dataDia?.enCurso    ?? []),
        ...(dataDia?.completados ?? []),
      ]
      return {
        allViajes:  all,
        viajes:     applyFilters(all),
        resumen:    dataDia?.resumen,
        totalPages: 1,
      }
    } else {
      const all = dataHist?.data ?? []
      const total = dataHist?.total ?? 0
      return {
        allViajes:  all,
        viajes:     applyFilters(all),
        resumen:    {
          total:       total,
          completados: all.filter(v => v.estado === 'completado').length,
          enCurso:     all.filter(v => v.estado === 'en_curso').length,
          kmTotal:     all.reduce((s, v) => s + (v.kmRecorridos || 0), 0),
        },
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      }
    }
  }, [esHoy, dataDia, dataHist, filters, divisionFiltro, pageSize])

  const handleRango = (d: string, h: string) => {
    setDesde(d); setHasta(h); setPage(1)
  }

  return (
    <div className="p-5 flex flex-col gap-5">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Viajes libres</h1>
          <p className="text-[13px] text-[#8B949E] mt-0.5">
            Detectados automáticamente desde eventos de geocerca · RedGPS
          </p>
        </div>

        {/* Controles de filtro */}
        <div className="flex gap-2 flex-wrap items-center">
          <RangoFechas desde={desde} hasta={hasta} onChange={handleRango} />

          <select
            className="bg-[#161B22] border border-white/[0.08] rounded-lg px-3 py-1.5 text-[12px] text-[#E6EDF3] outline-none"
            value={divisionFiltro}
            onChange={e => { setDivisionFiltro(e.target.value); setPage(1) }}
          >
            <option value="">Todas las unidades de negocio</option>
            {(divConfig?.divisiones ?? []).map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>

          {(hasFilters || divisionFiltro) && (
            <button
              className="btn btn-ghost text-[11px] px-2.5 py-1 text-blue-400 hover:text-blue-300"
              onClick={() => { clearFilters(); setDivisionFiltro('') }}
            >
              Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {/* Indicador de período */}
      {!esHoy && (
        <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3.5 py-2.5 text-[12px] text-blue-300">
          <Calendar size={13} />
          Mostrando historial del {formatFecha(desde)}
          {desde !== hasta ? ` al ${formatFecha(hasta)}` : ''}
          {dataHist?.source === 'mysql' && <span className="text-blue-400/60 ml-1">· MySQL</span>}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat-card">
          <p className="stat-label">Total{esHoy ? ' hoy' : ''}</p>
          <p className="stat-value text-blue-400">{resumen?.total ?? '—'}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Completados</p>
          <p className="stat-value text-emerald-400">{resumen?.completados ?? '—'}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">En curso</p>
          <p className="stat-value text-amber-400">{resumen?.enCurso ?? '—'}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Km totales</p>
          <p className="stat-value">{resumen?.kmTotal ? `${resumen.kmTotal.toFixed(1)} km` : '—'}</p>
        </div>
      </div>

      {/* Resumen por división */}
      {(() => {
        const counts: Record<string, number> = {}
        for (const v of viajes) {
          const d = v.division || 'Sin unidad de negocio'
          counts[d] = (counts[d] || 0) + 1
        }
        const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
        if (entries.length === 0) return null
        return (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-[#6E7681] mr-1">Por unidad de negocio:</span>
            {entries.map(([div, count]) => (
              <span
                key={div}
                className={`badge ${div === 'Sin unidad de negocio' ? 'badge-gray' : divisionClass(div)} text-[11px] px-2.5 py-1 cursor-pointer transition-opacity ${divisionFiltro && divisionFiltro !== div ? 'opacity-40' : ''}`}
                onClick={() => setDivisionFiltro(prev => prev === div ? '' : (div === 'Sin unidad de negocio' ? '' : div))}
                title={`Filtrar por ${div}`}
              >
                {div} <span className="font-bold ml-1">{count}</span>
              </span>
            ))}
          </div>
        )
      })()}

      {/* Tabla */}
      <div className="card">
        {isLoading ? (
          <div className="p-8 text-center text-[#6E7681] text-[13px]">Cargando viajes...</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th><ColumnFilter title="Equipo" values={uniqueValues(allViajes, v => v.codigoEquipo ?? v.etiqueta ?? v.patente ?? '—')} selected={filters.equipo} onChange={s => setFilter('equipo', s)} /></th>
                    <th><ColumnFilter title="Chofer" values={uniqueValues(allViajes, v => v.chofer || 'Sin chofer')} selected={filters.chofer} onChange={s => setFilter('chofer', s)} /></th>
                    <th><ColumnFilter title="Unidad de negocio" values={uniqueValues(allViajes, v => v.division || '—')} selected={filters.division} onChange={s => setFilter('division', s)} /></th>
                    <th><ColumnFilter title="Subgrupo" values={uniqueValues(allViajes, v => v.subgrupo || '—')} selected={filters.subgrupo} onChange={s => setFilter('subgrupo', s)} /></th>
                    <th><ColumnFilter title="Origen" values={uniqueValues(allViajes, v => v.geocercaOrigen?.nombre || '—')} selected={filters.origen} onChange={s => setFilter('origen', s)} /></th>
                    <th><ColumnFilter title="Destino" values={uniqueValues(allViajes, v => v.geocercaDestino?.nombre || '—')} selected={filters.destino} onChange={s => setFilter('destino', s)} /></th>
                    <th>Inicio</th>
                    <th>Fin</th>
                    <th>Duración</th>
                    <th>Km</th>
                    <th><ColumnFilter title="Estado" values={uniqueValues(allViajes, v => v.estado === 'completado' ? 'Completado' : v.estado === 'en_curso' ? 'En curso' : 'Tránsito')} selected={filters.estado} onChange={s => setFilter('estado', s)} /></th>
                  </tr>
                </thead>
                <tbody>
                  {viajes.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="text-center py-8 text-[#6E7681]">
                        {esHoy
                          ? 'No hay viajes detectados todavía. El sistema los detecta automáticamente cuando los equipos entran y salen de geocercas.'
                          : 'No se encontraron viajes en el período seleccionado.'}
                      </td>
                    </tr>
                  ) : viajes.map(v => (
                    <tr key={v.id}>
                      {/* Equipo — código interno principal, patente secundaria */}
                      <td>
                        <div>
                          <span className="font-semibold font-mono">{v.codigoEquipo ?? v.etiqueta ?? v.patente}</span>
                          {v.patente && v.patente !== v.codigoEquipo && (
                            <p className="text-[10px] text-[#8B949E] mt-0.5">{v.patente}</p>
                          )}
                        </div>
                      </td>
                      <td>
                        {v.chofer
                          ? <div className="drv-chip"><div className="drv-av">{v.chofer.slice(0,2).toUpperCase()}</div>{v.chofer}</div>
                          : <span className="text-[#6E7681]">—</span>}
                      </td>
                      <td>
                        {v.division
                          ? <span className={`badge ${divisionClass(v.division)}`}>{v.division}</span>
                          : <span className="text-[#6E7681]">—</span>}
                      </td>
                      <td className="text-[#8B949E]">{v.subgrupo ?? '—'}</td>
                      <td className="text-[#8B949E]">{v.geocercaOrigen?.nombre ?? '—'}</td>
                      <td className="text-[#8B949E]">{v.geocercaDestino?.nombre ?? '—'}</td>
                      <td className="text-[#6E7681]">
                        {/* En histórico mostramos fecha + hora; en hoy solo hora */}
                        {esHoy
                          ? formatTS(v.timestampInicio)
                          : v.timestampInicio
                              ? new Date(v.timestampInicio).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
                              : '—'}
                      </td>
                      <td className="text-[#6E7681]">
                        {esHoy
                          ? formatTS(v.timestampFin)
                          : v.timestampFin
                              ? new Date(v.timestampFin).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
                              : '—'}
                      </td>
                      <td className="font-semibold text-amber-400">{formatDuracion(v.duracionMin)}</td>
                      <td className="text-[#8B949E]">{v.kmRecorridos != null ? `${v.kmRecorridos} km` : '—'}</td>
                      <td>
                        <span className={`badge ${
                          v.estado === 'completado' ? 'badge-green' :
                          v.estado === 'en_curso'   ? 'badge-blue'  : 'badge-gray'
                        }`}>
                          {v.estado === 'completado' ? 'Completado' : v.estado === 'en_curso' ? 'En curso' : 'Tránsito'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Paginador — solo en modo histórico */}
            {!esHoy && totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.06] text-[12px]">
                <span className="text-[#6E7681]">
                  Página {page} de {totalPages} · {dataHist?.total ?? 0} viajes
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    className="btn btn-ghost px-2.5 py-1"
                    disabled={page <= 1}
                    onClick={() => setPage(p => p - 1)}
                  >
                    <ChevronLeft size={13} />
                  </button>
                  <button
                    className="btn btn-ghost px-2.5 py-1"
                    disabled={page >= totalPages}
                    onClick={() => setPage(p => p + 1)}
                  >
                    <ChevronRight size={13} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
