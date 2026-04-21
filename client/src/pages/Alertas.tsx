import { useState, useMemo } from 'react'
import {
  useAlertas, useAlertasResumen, useAlertasRanking, useMarcarAlertasLeidas,
  divisionClass, formatTS,
} from '../hooks/hooks'
import { useEmpresa } from '../components/layout/Layout'
import ColumnFilter from '../components/ColumnFilter'
import { uniqueValues, useColumnFilters } from '../components/ColumnFilter'
import type { Alerta } from '../api/api'
import type { AlertaRanking } from '../api/api'
import {
  Bell, BellOff, Gauge, Zap, ZapOff, AlertTriangle, Fuel,
  ChevronLeft, ChevronRight, CheckCheck, Eye, Filter, Trophy,
} from 'lucide-react'

function hoy() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }) }

// ── Iconos por tipo de alerta ───────────────────────────────────────────────

const TIPO_CONFIG: Record<string, { icon: typeof Bell; color: string; bg: string }> = {
  velocidad:        { icon: Gauge,          color: 'text-red-400',     bg: 'bg-red-400/10' },
  ralenti:          { icon: Zap,            color: 'text-orange-400',  bg: 'bg-orange-400/10' },
  combustible:      { icon: Fuel,            color: 'text-amber-400',   bg: 'bg-amber-400/10' },
  ignicion_on:      { icon: Zap,            color: 'text-green-400',   bg: 'bg-green-400/10' },
  ignicion_off:     { icon: ZapOff,         color: 'text-gray-400',    bg: 'bg-gray-400/10' },
  panico:           { icon: AlertTriangle,  color: 'text-red-500',     bg: 'bg-red-500/10' },
  bateria:          { icon: AlertTriangle,  color: 'text-yellow-400',  bg: 'bg-yellow-400/10' },
  desconexion:      { icon: BellOff,        color: 'text-gray-500',    bg: 'bg-gray-500/10' },
  otro:             { icon: Bell,           color: 'text-blue-400',    bg: 'bg-blue-400/10' },
}

function AlertaIcon({ tipo }: { tipo: string }) {
  const cfg = TIPO_CONFIG[tipo] || TIPO_CONFIG.otro
  const Icon = cfg.icon
  return (
    <div className={`w-7 h-7 rounded-lg ${cfg.bg} flex items-center justify-center`}>
      <Icon size={14} className={cfg.color} />
    </div>
  )
}

function tipoBadgeClass(tipo: string) {
  const map: Record<string, string> = {
    velocidad:        'badge-red',
    ralenti:          'badge-purple',
    combustible:      'badge-amber',
    ignicion_on:      'badge-green',
    ignicion_off:     'badge-gray',
    panico:           'badge-red',
    bateria:          'badge-amber',
    desconexion:      'badge-gray',
    otro:             'badge-blue',
  }
  return map[tipo] ?? 'badge-gray'
}

// ── Componente principal ────────────────────────────────────────────────────

export default function Alertas() {
  const { empresa } = useEmpresa()

  // Filtros
  const [modo, setModo]     = useState<'hoy' | 'historico'>('hoy')
  const [desde, setDesde]   = useState(hoy())
  const [hasta, setHasta]   = useState(hoy())
  const [filtroLeida, setFiltroLeida] = useState<string>('')  // '' = todas, '0' = no leidas, '1' = leidas
  const [page, setPage]     = useState(1)
  const pageSize = 50

  // Column filters
  const [filters, setFilter, clearAll, isAnyActive] = useColumnFilters<
    'tipo' | 'equipo' | 'division'
  >(['tipo', 'equipo', 'division'])

  // Queries
  const queryParams = {
    empresa: empresa || undefined,
    desde: modo === 'hoy' ? hoy() : desde,
    hasta: modo === 'hoy' ? hoy() : hasta,
    leida: filtroLeida || undefined,
    page,
    pageSize,
  }

  const { data: alertasData, isLoading } = useAlertas(queryParams)
  const { data: resumen }  = useAlertasResumen({
    empresa: empresa || undefined,
    desde: modo === 'hoy' ? hoy() : desde,
    hasta: modo === 'hoy' ? hoy() : hasta,
  })
  const { data: ranking } = useAlertasRanking({
    empresa: empresa || undefined,
    desde: modo === 'hoy' ? hoy() : desde,
    hasta: modo === 'hoy' ? hoy() : hasta,
  })
  const marcarLeidas = useMarcarAlertasLeidas()

  // Datos
  const alertas = alertasData?.data ?? []
  const total   = alertasData?.total ?? 0
  const totalPages = Math.ceil(total / pageSize)

  // Filtrar por column filters (client-side sobre la pagina actual)
  const alertasFiltradas = useMemo(() => {
    let list = alertas
    if (filters.tipo.size > 0)      list = list.filter(a => filters.tipo.has(a.tipoLabel))
    if (filters.equipo.size > 0)    list = list.filter(a => filters.equipo.has(a.etiqueta || ''))
    if (filters.division.size > 0)  list = list.filter(a => filters.division.has(a.division || 'Sin unidad de negocio'))
    return list
  }, [alertas, filters])

  // Valores unicos para filtros
  const uTipo     = uniqueValues(alertas, a => a.tipoLabel)
  const uEquipo   = uniqueValues(alertas, a => a.etiqueta || '')
  const uDivision = uniqueValues(alertas, a => a.division || 'Sin unidad de negocio')

  function handleMarcarTodas() {
    marcarLeidas.mutate('all')
  }

  return (
    <div className="p-6 space-y-5">

      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center">
            <Bell size={18} className="text-amber-400" />
          </div>
          <div>
            <h1 className="text-[18px] font-semibold text-[#E6EDF3]">Alertas</h1>
            <p className="text-[11px] text-[#8B949E]">
              {modo === 'hoy' ? 'Alertas del dia' : `${desde} al ${hasta}`}
              {resumen ? ` · ${resumen.total} alertas` : ''}
              {resumen && resumen.noLeidas > 0 ? ` · ${resumen.noLeidas} sin leer` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Modo hoy / historico */}
          <div className="flex gap-1 bg-[#161B22] border border-white/[0.07] rounded-lg p-0.5">
            <button
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                modo === 'hoy' ? 'bg-brand text-white' : 'text-[#8B949E] hover:text-[#E6EDF3]'
              }`}
              onClick={() => { setModo('hoy'); setPage(1) }}
            >Hoy</button>
            <button
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                modo === 'historico' ? 'bg-brand text-white' : 'text-[#8B949E] hover:text-[#E6EDF3]'
              }`}
              onClick={() => { setModo('historico'); setPage(1) }}
            >Historico</button>
          </div>

          {modo === 'historico' && (
            <div className="flex items-center gap-2">
              <input type="date" value={desde} onChange={e => { setDesde(e.target.value); setPage(1) }}
                className="input text-[11px] px-2 py-1.5" />
              <span className="text-[11px] text-[#8B949E]">a</span>
              <input type="date" value={hasta} onChange={e => { setHasta(e.target.value); setPage(1) }}
                className="input text-[11px] px-2 py-1.5" />
            </div>
          )}

          {/* Filtro leidas */}
          <select
            value={filtroLeida}
            onChange={e => { setFiltroLeida(e.target.value); setPage(1) }}
            className="input text-[11px] px-2 py-1.5"
          >
            <option value="">Todas</option>
            <option value="0">No leidas</option>
            <option value="1">Leidas</option>
          </select>

          {/* Marcar todas leidas */}
          {resumen && resumen.noLeidas > 0 && (
            <button
              onClick={handleMarcarTodas}
              className="btn btn-ghost text-[11px] flex items-center gap-1.5"
              disabled={marcarLeidas.isPending}
            >
              <CheckCheck size={13} />
              Marcar todas leidas
            </button>
          )}
        </div>
      </div>

      {/* ── Stats cards ───────────────────────────────────────────── */}
      {resumen && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {resumen.porTipo.map(t => (
            <div key={t.tipo} className="card px-3 py-2.5">
              <div className="flex items-center gap-2 mb-1">
                <AlertaIcon tipo={t.tipo} />
                <span className="text-[20px] font-bold text-[#E6EDF3]">{t.cantidad}</span>
              </div>
              <p className="text-[10px] text-[#8B949E] leading-tight">{t.tipoLabel}</p>
            </div>
          ))}
          {resumen.porTipo.length === 0 && (
            <div className="card px-3 py-2.5 col-span-full">
              <p className="text-[12px] text-[#8B949E] text-center py-4">No hay alertas en el periodo seleccionado</p>
            </div>
          )}
        </div>
      )}

      {/* ── Ranking de vehiculos ────────────────────────────────── */}
      {ranking && ranking.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title flex items-center gap-2">
              <Trophy size={14} className="text-amber-400" />
              Ranking de vehiculos con mas alertas
              <span className="text-[11px] text-[#8B949E] font-normal ml-1">Top {ranking.length}</span>
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="w-8">#</th>
                  <th>Vehiculo</th>
                  <th>Empresa</th>
                  <th className="text-right">Total</th>
                  <th>Desglose por tipo</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((v: AlertaRanking, i: number) => {
                  const maxAlertas = ranking[0]?.totalAlertas || 1
                  const pct = Math.round((v.totalAlertas / maxAlertas) * 100)
                  return (
                    <tr key={v.codigoEquipo}>
                      <td className="text-[12px] text-[#8B949E] font-medium">{i + 1}</td>
                      <td className="font-medium text-[#E6EDF3]">{v.etiqueta}</td>
                      <td className="text-[11px] text-[#8B949E]">{v.empresa || '—'}</td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-20 h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-amber-400/70 rounded-full"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-[12px] font-semibold text-[#E6EDF3] min-w-[28px] text-right">
                            {v.totalAlertas}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(v.porTipo).map(([tipo, cnt]) => (
                            <span key={tipo} className={`badge ${tipoBadgeClass(tipo)} text-[9px]`}>
                              {tipo} {cnt}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tabla de alertas ──────────────────────────────────────── */}
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <h2 className="card-title flex items-center gap-2">
            <Filter size={14} className="text-[#8B949E]" />
            Detalle de alertas
            <span className="text-[11px] text-[#8B949E] font-normal ml-1">
              {alertasFiltradas.length} de {total}
            </span>
          </h2>
          {isAnyActive && (
            <button onClick={clearAll} className="text-[10px] text-brand-light hover:underline">
              Limpiar filtros
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th className="w-8"></th>
                <th>
                  <ColumnFilter
                    title="Tipo"
                    values={uTipo}
                    selected={filters.tipo}
                    onChange={(s: Set<string>) => setFilter('tipo', s)}
                  />
                </th>
                <th>
                  <ColumnFilter
                    title="Equipo"
                    values={uEquipo}
                    selected={filters.equipo}
                    onChange={(s: Set<string>) => setFilter('equipo', s)}
                  />
                </th>
                <th>
                  <ColumnFilter
                    title="Unidad de negocio"
                    values={uDivision}
                    selected={filters.division}
                    onChange={(s: Set<string>) => setFilter('division', s)}
                  />
                </th>
                <th>Descripcion</th>
                <th>Velocidad</th>
                <th>Hora</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="text-center text-[12px] text-[#8B949E] py-8">Cargando...</td></tr>
              ) : alertasFiltradas.length === 0 ? (
                <tr><td colSpan={8} className="text-center text-[12px] text-[#8B949E] py-8">No hay alertas</td></tr>
              ) : alertasFiltradas.map(a => (
                <tr key={a.id} className={a.leida ? 'opacity-60' : ''}>
                  <td><AlertaIcon tipo={a.tipo} /></td>
                  <td><span className={`badge ${tipoBadgeClass(a.tipo)}`}>{a.tipoLabel}</span></td>
                  <td className="font-medium text-[#E6EDF3]">{a.etiqueta || '—'}</td>
                  <td>
                    {a.division
                      ? <span className={`badge ${divisionClass(a.division)}`}>{a.division}</span>
                      : <span className="text-[#484F58]">—</span>
                    }
                  </td>
                  <td className="text-[11px] text-[#8B949E] max-w-[200px] truncate" title={a.descripcion || ''}>
                    {a.descripcion || '—'}
                  </td>
                  <td>
                    {a.velocidad !== null && a.velocidad > 0
                      ? <span className={`text-[11px] ${a.velocidad > 80 ? 'text-red-400 font-medium' : 'text-[#8B949E]'}`}>
                          {a.velocidad.toFixed(0)} km/h
                        </span>
                      : <span className="text-[#484F58]">—</span>
                    }
                  </td>
                  <td className="text-[11px] text-[#8B949E] whitespace-nowrap">{formatTS(a.timestampAlerta)}</td>
                  <td>
                    {!a.leida && (
                      <button
                        onClick={() => marcarLeidas.mutate([a.id])}
                        className="text-[#484F58] hover:text-brand-light transition-colors"
                        title="Marcar como leida"
                      >
                        <Eye size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Paginacion ──────────────────────────────────────────── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.07]">
            <span className="text-[11px] text-[#8B949E]">
              Pagina {page} de {totalPages} ({total} alertas)
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="btn btn-ghost px-2 py-1 text-[11px] disabled:opacity-30"
              ><ChevronLeft size={14} /></button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="btn btn-ghost px-2 py-1 text-[11px] disabled:opacity-30"
              ><ChevronRight size={14} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
