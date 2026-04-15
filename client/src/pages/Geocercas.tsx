import { useState } from 'react'
import { useGeocercas, useVehiculos } from '../hooks/hooks'
import { useEmpresa } from '../components/layout/Layout'

const TIPO_LABEL: Record<number, string> = { 1: 'Poligonal', 2: 'Circular', 3: 'Lineal' }

export default function Geocercas() {
  const { empresa } = useEmpresa()
  const { data: geocercas = [], isLoading, error } = useGeocercas({ empresa: empresa || undefined })
  const { data: vehiculos = [] } = useVehiculos({ empresa: empresa || undefined })
  const [busqueda, setBusqueda] = useState('')

  const filtered = geocercas.filter(g =>
    g.nombre.toLowerCase().includes(busqueda.toLowerCase())
  )

  const totalDentro   = geocercas.reduce((s, g) => s + g.equiposDentro.length, 0)
  const totalEnRuta   = vehiculos.length - totalDentro
  const totalIngresos = geocercas.reduce((s, g) => s + g.ingresosHoy, 0)
  const totalSalidas  = geocercas.reduce((s, g) => s + g.salidasHoy, 0)

  return (
    <div className="p-5 flex flex-col gap-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Geocercas</h1>
          <p className="text-[13px] text-[#8B949E] mt-0.5">
            {isLoading ? 'Cargando...' : `${geocercas.length} zonas sincronizadas desde RedGPS · se actualiza cada 1 hora`}
          </p>
        </div>
        <div className="flex gap-2">
          <input
            className="input w-52"
            placeholder="Buscar geocerca..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="stat-card"><p className="stat-label">Geocercas activas</p><p className="stat-value text-blue-400">{geocercas.filter(g => g.visible).length}</p></div>
        <div className="stat-card"><p className="stat-label">Equipos en geocercas</p><p className="stat-value text-emerald-400">{totalDentro}</p></div>
        <div className="stat-card"><p className="stat-label">En ruta (fuera)</p><p className="stat-value text-amber-400">{totalEnRuta > 0 ? totalEnRuta : '—'}</p><p className="stat-sub">de {vehiculos.length} totales</p></div>
        <div className="stat-card"><p className="stat-label">Ingresos hoy</p><p className="stat-value text-emerald-400">{totalIngresos}</p></div>
        <div className="stat-card"><p className="stat-label">Salidas hoy</p><p className="stat-value text-amber-400">{totalSalidas}</p></div>
      </div>

      {/* Cards de geocercas */}
      {error ? (
        <div className="card p-8 text-center text-red-400 text-[13px]">
          Error al cargar geocercas.
        </div>
      ) : isLoading ? (
        <div className="card p-8 text-center text-[#6E7681] text-[13px]">Cargando geocercas...</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(g => (
            <div key={g.idCerca} className="card hover:border-white/[0.12] transition-colors cursor-default">
              <div className="p-4">
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-[13px] font-semibold">{g.nombre}</p>
                    <p className="text-[10px] text-[#6E7681] mt-0.5">
                      {TIPO_LABEL[g.tipoCerca] ?? 'Desconocido'}
                      {g.tipoCerca === 2 && g.radio > 0 ? ` · ${g.radio}m radio` : ''}
                    </p>
                  </div>
                  <span className={`badge ${g.visible ? 'badge-green' : 'badge-gray'}`}>
                    {g.visible ? 'Activa' : 'Inactiva'}
                  </span>
                </div>

                {/* Equipos dentro */}
                {g.equiposDentro.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {g.equiposDentro.map(p => (
                      <span key={p} className="badge badge-blue text-[9px]">{p}</span>
                    ))}
                  </div>
                )}

                {/* Stats del día */}
                <div className="grid grid-cols-3 gap-2 pt-3 border-t border-white/[0.07]">
                  <div className="text-center">
                    <p className="text-[16px] font-bold text-blue-400">{g.equiposDentro.length}</p>
                    <p className="text-[10px] text-[#6E7681]">Dentro</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[16px] font-bold text-emerald-400">{g.ingresosHoy}</p>
                    <p className="text-[10px] text-[#6E7681]">Ingresos hoy</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[16px] font-bold text-amber-400">{g.salidasHoy}</p>
                    <p className="text-[10px] text-[#6E7681]">Salidas hoy</p>
                  </div>
                </div>
              </div>
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="col-span-3 card p-8 text-center text-[#6E7681] text-[13px]">
              No hay geocercas que coincidan con la búsqueda.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
