import { useState } from 'react'
import { useVehiculos, useSetDivision, useSetEnTaller, useDivisionesValidas, estadoBadgeClass, estadoLabel, divisionClass } from '../hooks/hooks'
import { useEmpresa } from '../components/layout/Layout'
import { useAuth } from '../context/AuthContext'
import type { Vehiculo } from '../api/api'
import { Check, X, Pencil, MapPin, Wrench } from 'lucide-react'
import ColumnFilter, { useColumnFilters, uniqueValues } from '../components/ColumnFilter'

// ── Modal de asignación de división ──────────────────────────────────────────
// Reemplaza el editor inline que no era visible — ahora es un modal claro

interface DivisionModalProps {
  vehiculo: Vehiculo
  onClose:  () => void
}

function DivisionModal({ vehiculo, onClose }: DivisionModalProps) {
  const { data: validas }              = useDivisionesValidas()
  const { mutate, isPending, isError } = useSetDivision()

  const [div, setDiv] = useState(vehiculo.division ?? '')
  const [sub, setSub] = useState(vehiculo.subgrupo ?? '')

  const divisiones = validas?.divisiones ?? []
  const subdivisiones: Record<string, string[]> = validas?.subdivisiones ?? {}
  const subsParaDiv = div ? (subdivisiones[div] ?? []) : []

  function guardar() {
    mutate(
      { codigo: vehiculo.codigo || vehiculo.etiqueta, division: div, subgrupo: subsParaDiv.length > 0 ? sub : undefined },
      { onSuccess: onClose }
    )
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-[#161B22] border border-white/[0.12] rounded-xl w-full max-w-sm shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
          <div>
            <h2 className="text-[14px] font-semibold">Asignar unidad de negocio</h2>
            <p className="text-[11px] text-[#6E7681] mt-0.5">
              <span className="font-mono font-semibold">{vehiculo.codigo}</span>
              {vehiculo.patente && vehiculo.patente !== vehiculo.codigo &&
                <span className="ml-1.5">{vehiculo.patente}</span>}
            </p>
          </div>
          <button onClick={onClose} className="text-[#6E7681] hover:text-[#E6EDF3] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div className="p-5 flex flex-col gap-4">

          {/* División */}
          <label className="block">
            <span className="text-[11px] text-[#8B949E] mb-1.5 block uppercase tracking-wider">Unidad de negocio</span>
            <select
              className="input w-full"
              value={div}
              onChange={e => { setDiv(e.target.value); setSub('') }}
            >
              <option value="">Sin unidad de negocio</option>
              {divisiones.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>

          {/* Subgrupo — para cualquier división que tenga subdivisiones */}
          {div && subsParaDiv.length > 0 && (
            <label className="block">
              <span className="text-[11px] text-[#8B949E] mb-1.5 block uppercase tracking-wider">
                Subgrupo
              </span>
              <select
                className="input w-full"
                value={sub}
                onChange={e => setSub(e.target.value)}
              >
                <option value="">Sin subgrupo</option>
                {subsParaDiv.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <p className="text-[10px] text-[#6E7681] mt-1.5">
                Subgrupo dentro de la unidad de negocio {div}
              </p>
            </label>
          )}

          {isError && (
            <p className="text-[12px] text-red-400 bg-red-500/10 rounded-md px-3 py-2">
              Error al guardar. Intentá de nuevo.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-white/[0.07]">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardar} disabled={isPending}>
            {isPending ? 'Guardando...' : <><Check size={12} />Guardar</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Fila de equipo ────────────────────────────────────────────────────────────

function EquipoRow({ v, isAdmin }: { v: Vehiculo; isAdmin: boolean }) {
  const [showModal, setShowModal] = useState(false)
  const tallerMutation = useSetEnTaller()

  return (
    <>
      {showModal && <DivisionModal vehiculo={v} onClose={() => setShowModal(false)} />}
      <tr>
        {/* Código interno + patente */}
        <td>
          <p className="font-semibold font-mono">{v.codigo}</p>
          {v.patente && v.patente !== v.codigo && (
            <p className="text-[10px] text-[#8B949E]">{v.patente}</p>
          )}
          <p className="text-[10px] text-[#6E7681]">
            {[v.marca, v.modelo].filter(Boolean).join(' ') || ''}
          </p>
        </td>

        {/* Grupo RedGPS */}
        <td className="text-[11px] text-[#8B949E]">
          {(v as any).grupoRedGps || '—'}
        </td>

        {/* División — botón de lápiz siempre visible */}
        <td>
          <div className="flex items-center gap-2">
            {v.division
              ? <span className={`badge ${divisionClass(v.division)}`}>{v.division}</span>
              : <span className="text-[#6E7681] text-[11px]">Sin unidad de negocio</span>}
            <button
              onClick={() => setShowModal(true)}
              className="text-[#6E7681] hover:text-[#8B949E] transition-colors p-0.5 rounded"
              title="Asignar unidad de negocio"
            >
              <Pencil size={11} />
            </button>
          </div>
        </td>

        {/* Subgrupo */}
        <td className="text-[#8B949E]">
          {v.subgrupo ? <span className="text-[11px]">↳ {v.subgrupo}</span> : '—'}
        </td>

        {/* Chofer */}
        <td>
          {v.chofer
            ? <div className="drv-chip">
                <div className="drv-av">{v.chofer.nombre.slice(0,2).toUpperCase()}</div>
                {v.chofer.nombre}
              </div>
            : <span className="text-[#6E7681] text-[11px]">Sin asignar</span>}
        </td>

        {/* Estado */}
        <td>
          <div className="flex items-center gap-1.5">
            <span className={`badge ${estadoBadgeClass(v.estado)}`}>
              <span className="w-[5px] h-[5px] rounded-full bg-current" />
              {estadoLabel(v.estado)}
            </span>
            {isAdmin && (
              <button
                onClick={() => tallerMutation.mutate({ codigo: v.codigo || v.etiqueta, enTaller: v.estado !== 'en_taller' })}
                className={`p-0.5 rounded transition-colors ${v.estado === 'en_taller' ? 'text-orange-400 hover:text-orange-300' : 'text-[#6E7681] hover:text-[#8B949E]'}`}
                title={v.estado === 'en_taller' ? 'Sacar de taller' : 'Enviar a taller'}
                disabled={tallerMutation.isPending}
              >
                <Wrench size={12} />
              </button>
            )}
          </div>
        </td>

        {/* Geocerca actual */}
        <td className="text-[#8B949E]">{v.geocercaActual ?? '—'}</td>

        {/* Velocidad */}
        <td>
          <span className={v.velocidad > 100 ? 'text-red-400 font-bold' : v.velocidad > 0 ? 'text-emerald-400' : 'text-[#6E7681]'}>
            {v.velocidad > 0 ? `${v.velocidad} km/h` : '—'}
          </span>
        </td>

        {/* Última actualización */}
        <td className="text-[#6E7681]">
          {v.ultimaActualizacion
            ? new Date(v.ultimaActualizacion).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
            : '—'}
        </td>

        {/* Link al mapa */}
        <td>
          {v.latitud && v.longitud ? (
            <a
              href={`https://www.google.com/maps?q=${v.latitud},${v.longitud}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 transition-colors"
              title={`${v.latitud}, ${v.longitud}`}
            >
              <MapPin size={14} />
            </a>
          ) : (
            <span className="text-[#6E7681]">—</span>
          )}
        </td>
      </tr>
    </>
  )
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function Equipos() {
  const { isAdmin } = useAuth()
  const { empresa } = useEmpresa()
  const [filters, setFilter, clearFilters, hasFilters] = useColumnFilters([
    'equipo', 'grupo', 'division', 'subgrupo', 'chofer', 'estado', 'geocerca'
  ])

  const { data: vehiculos = [], isLoading, error } = useVehiculos({ empresa: empresa || undefined })

  const filtered = vehiculos.filter(v => {
    if (filters.equipo.size > 0 && !filters.equipo.has(v.codigo || '—')) return false
    if (filters.grupo.size > 0 && !filters.grupo.has((v as any).grupoRedGps || '—')) return false
    if (filters.division.size > 0 && !filters.division.has(v.division || 'Sin unidad de negocio')) return false
    if (filters.subgrupo.size > 0 && !filters.subgrupo.has(v.subgrupo || '—')) return false
    if (filters.chofer.size > 0 && !filters.chofer.has(v.chofer?.nombre || 'Sin asignar')) return false
    if (filters.estado.size > 0 && !filters.estado.has(estadoLabel(v.estado))) return false
    if (filters.geocerca.size > 0 && !filters.geocerca.has(v.geocercaActual || '—')) return false
    return true
  }).sort((a, b) => (a.codigo ?? '').localeCompare(b.codigo ?? ''))

  const enRuta    = vehiculos.filter(v => v.estado === 'en_ruta').length
  const detenido  = vehiculos.filter(v => v.estado === 'detenido_encendido').length
  const inactivo  = vehiculos.filter(v => v.estado === 'inactivo').length
  const enTaller  = vehiculos.filter(v => v.estado === 'en_taller').length
  const sinDivision = vehiculos.filter(v => !v.division).length

  return (
    <div className="p-5 flex flex-col gap-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Equipos</h1>
          <p className="text-[13px] text-[#8B949E] mt-0.5">
            {isLoading ? 'Cargando...' : `${vehiculos.length} unidades · sincronizado con RedGPS`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {hasFilters && (
            <button className="btn btn-ghost text-[11px] text-blue-400" onClick={clearFilters}>
              ✕ Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="stat-card">
          <p className="stat-label">En ruta</p>
          <p className="stat-value text-emerald-400">{enRuta}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Detenidos</p>
          <p className="stat-value text-amber-400">{detenido}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Inactivos</p>
          <p className="stat-value">{inactivo}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">En taller</p>
          <p className="stat-value text-orange-400">{enTaller}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Sin unidad de negocio</p>
          <p className="stat-value text-[#6E7681]">{sinDivision}</p>
          {sinDivision > 0 && (
            <p className="text-[10px] text-[#6E7681] mt-0.5">hacé click en ✎ para asignar</p>
          )}
        </div>
      </div>

      {/* Tabla */}
      <div className="card">
        {error ? (
          <div className="p-8 text-center text-red-400 text-[13px]">
            Error al cargar equipos. Verificá la conexión con el servidor.
          </div>
        ) : isLoading ? (
          <div className="p-8 text-center text-[#6E7681] text-[13px]">Cargando equipos...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th><ColumnFilter title="Equipo" values={uniqueValues(vehiculos, v => v.codigo || '—')} selected={filters.equipo} onChange={s => setFilter('equipo', s)} /></th>
                  <th><ColumnFilter title="Grupo RedGPS" values={uniqueValues(vehiculos, v => (v as any).grupoRedGps || '—')} selected={filters.grupo} onChange={s => setFilter('grupo', s)} /></th>
                  <th><ColumnFilter title="Unidad de negocio" values={uniqueValues(vehiculos, v => v.division || 'Sin unidad de negocio')} selected={filters.division} onChange={s => setFilter('division', s)} /></th>
                  <th><ColumnFilter title="Subgrupo" values={uniqueValues(vehiculos, v => v.subgrupo || '—')} selected={filters.subgrupo} onChange={s => setFilter('subgrupo', s)} /></th>
                  <th><ColumnFilter title="Chofer" values={uniqueValues(vehiculos, v => v.chofer?.nombre || 'Sin asignar')} selected={filters.chofer} onChange={s => setFilter('chofer', s)} /></th>
                  <th><ColumnFilter title="Estado" values={uniqueValues(vehiculos, v => estadoLabel(v.estado))} selected={filters.estado} onChange={s => setFilter('estado', s)} /></th>
                  <th><ColumnFilter title="Geocerca" values={uniqueValues(vehiculos, v => v.geocercaActual || '—')} selected={filters.geocerca} onChange={s => setFilter('geocerca', s)} /></th>
                  <th>Vel.</th>
                  <th>Última activ.</th>
                  <th>Mapa</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-8 text-[#6E7681]">
                      No hay equipos con los filtros seleccionados
                    </td>
                  </tr>
                ) : filtered.map(v => <EquipoRow key={v.id} v={v} isAdmin={isAdmin} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
