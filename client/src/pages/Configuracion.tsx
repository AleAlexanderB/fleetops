import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Settings, Plus, X, Shield, Building2, DollarSign, ArrowRight, Users, Pencil, Key, ToggleLeft, ToggleRight } from 'lucide-react'
import { http, api, type Tarifa, type Usuario } from '../api/api'
import { useEmpresas, useGeocercas, useTarifas } from '../hooks/hooks'
import { useAuth } from '../context/AuthContext'

// ── Tipos ────────────────────────────────────────────────────────────────────

interface DivisionesValidas {
  divisiones: string[]
  subdivisiones: Record<string, string[]>
}

interface Vehiculo {
  division: string | null
  empresa: string | null
}

// ── Colores por division ─────────────────────────────────────────────────────

const DIV_COLORS: Record<string, string> = {
  'Hormigon':     'bg-teal-500',
  'Hormigón':     'bg-teal-500',
  'Agregados':    'bg-amber-500',
  'Premoldeados': 'bg-purple-500',
  'Obras':        'bg-emerald-500',
  'Logística':    'bg-blue-400',
  'Logistica':    'bg-blue-400',
  'Corralón':     'bg-red-400',
  'Corralon':     'bg-red-400',
  'Taller':       'bg-gray-500',
}

function divColor(name: string) {
  return DIV_COLORS[name] ?? 'bg-indigo-500'
}

// ── Componente principal ─────────────────────────────────────────────────────

export default function Configuracion() {
  const qc = useQueryClient()

  // Empresa seleccionada para configuracion
  const { data: empresas = [] } = useEmpresas()
  const [empresa, setEmpresa] = useState('')

  // Seleccionar primera empresa disponible automaticamente
  const empresaActiva = empresa || empresas[0] || ''

  // ── Queries ──────────────────────────────────────────────────────────────

  const {
    data: validas,
    isLoading: loadingDiv,
    isError: errorDiv,
  } = useQuery<DivisionesValidas>({
    queryKey: ['divisiones-validas', empresaActiva],
    queryFn: () =>
      http.get('/divisiones/validas', { params: { empresa: empresaActiva || undefined } }).then(r => {
        const d = r.data?.data ?? r.data
        return {
          divisiones: d.divisiones ?? [],
          subdivisiones: d.subdivisiones ?? d.subgruposObras ?? {},
        }
      }),
    staleTime: 30_000,
    enabled: !!empresaActiva,
  })

  const { data: vehiculos = [], isLoading: loadingVeh } = useQuery<Vehiculo[]>({
    queryKey: ['vehiculos', empresaActiva],
    queryFn: () => http.get('/vehiculos', { params: { empresa: empresaActiva || undefined } }).then(r => r.data?.data ?? r.data ?? []),
    staleTime: 30_000,
  })

  const divisiones = validas?.divisiones ?? []
  const subdivisiones = validas?.subdivisiones ?? {}

  // Conteo de vehiculos por division
  const vehiculosPorDiv = useMemo(() => {
    const map: Record<string, number> = {}
    for (const v of vehiculos) {
      if (v.division) map[v.division] = (map[v.division] ?? 0) + 1
    }
    return map
  }, [vehiculos])

  // ── Mutations ────────────────────────────────────────────────────────────

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['divisiones-validas'] })
    qc.invalidateQueries({ queryKey: ['vehiculos'] })
  }

  const addDiv = useMutation({
    mutationFn: (nombre: string) =>
      http.post('/divisiones/config', { nombre, empresa: empresaActiva }),
    onSuccess: invalidar,
  })

  const delDiv = useMutation({
    mutationFn: (nombre: string) =>
      http.delete(`/divisiones/config/${encodeURIComponent(nombre)}?empresa=${encodeURIComponent(empresaActiva)}`),
    onSuccess: invalidar,
  })

  const addSubdiv = useMutation({
    mutationFn: ({ division, nombre }: { division: string; nombre: string }) =>
      http.post(`/divisiones/config/${encodeURIComponent(division)}/subdivisiones`, { nombre, empresa: empresaActiva }),
    onSuccess: invalidar,
  })

  const delSubdiv = useMutation({
    mutationFn: ({ division, nombre }: { division: string; nombre: string }) =>
      http.delete(
        `/divisiones/config/${encodeURIComponent(division)}/subdivisiones/${encodeURIComponent(nombre)}?empresa=${encodeURIComponent(empresaActiva)}`,
      ),
    onSuccess: invalidar,
  })

  // ── Estado local ─────────────────────────────────────────────────────────

  const [newDiv, setNewDiv] = useState('')
  const [divError, setDivError] = useState('')

  const [selectedDiv, setSelectedDiv] = useState('')
  const [newSubdiv, setNewSubdiv] = useState('')
  const [subdivError, setSubdivError] = useState('')

  // Seleccionar primera division si no hay seleccion
  const activeDivForSub = selectedDiv || divisiones[0] || ''
  const currentSubdivs = subdivisiones[activeDivForSub] ?? []

  // ── Handlers ─────────────────────────────────────────────────────────────

  function handleAddDiv() {
    const nombre = newDiv.trim()
    if (!nombre) { setDivError('El nombre no puede estar vacio'); return }
    if (nombre.length > 50) { setDivError('Maximo 50 caracteres'); return }
    if (divisiones.some(d => d.toLowerCase() === nombre.toLowerCase())) {
      setDivError('Ya existe una unidad de negocio con ese nombre')
      return
    }
    setDivError('')
    addDiv.mutate(nombre, { onSuccess: () => setNewDiv('') })
  }

  function handleDeleteDiv(nombre: string) {
    const count = vehiculosPorDiv[nombre] ?? 0
    if (count > 0) return
    delDiv.mutate(nombre)
  }

  function handleAddSubdiv() {
    const nombre = newSubdiv.trim()
    if (!activeDivForSub) { setSubdivError('Selecciona una unidad de negocio primero'); return }
    if (!nombre) { setSubdivError('El nombre no puede estar vacio'); return }
    if (nombre.length > 50) { setSubdivError('Maximo 50 caracteres'); return }
    if (currentSubdivs.some(s => s.toLowerCase() === nombre.toLowerCase())) {
      setSubdivError('Ya existe esa subdivision')
      return
    }
    setSubdivError('')
    addSubdiv.mutate(
      { division: activeDivForSub, nombre },
      { onSuccess: () => setNewSubdiv('') },
    )
  }

  function handleDeleteSubdiv(nombre: string) {
    if (!activeDivForSub) return
    delSubdiv.mutate({ division: activeDivForSub, nombre })
  }

  // ── Loading / Error ──────────────────────────────────────────────────────

  const isLoading = loadingDiv || loadingVeh

  if (isLoading) {
    return (
      <div className="p-5 flex flex-col gap-5">
        <div>
          <h1 className="text-xl font-semibold">Configuracion</h1>
          <p className="text-[13px] text-[#8B949E] mt-0.5">Gestión de unidades de negocio y subdivisiones por empresa</p>
        </div>
        <div className="flex items-center justify-center py-20">
          <div className="flex items-center gap-3 text-[#8B949E] text-[13px]">
            <div className="w-5 h-5 border-2 border-[#8B949E] border-t-transparent rounded-full animate-spin" />
            Cargando configuracion...
          </div>
        </div>
      </div>
    )
  }

  if (errorDiv) {
    return (
      <div className="p-5 flex flex-col gap-5">
        <div>
          <h1 className="text-xl font-semibold">Configuracion</h1>
          <p className="text-[13px] text-[#8B949E] mt-0.5">Gestión de unidades de negocio y subdivisiones por empresa</p>
        </div>
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-5 py-4 text-[13px] text-red-400">
          Error al cargar la configuracion de unidades de negocio. Verifica la conexion con el servidor.
        </div>
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-5 flex flex-col gap-5">

      {/* Titulo + selector empresa */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-brand/15 rounded-lg flex items-center justify-center">
            <Settings size={18} className="text-brand-light" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Configuracion</h1>
            <p className="text-[13px] text-[#8B949E] mt-0.5">Unidades de negocio y subdivisiones por empresa</p>
          </div>
        </div>

        {/* Selector de empresa */}
        {empresas.length > 0 && (
          <div className="flex items-center gap-2">
            <Building2 size={14} className="text-[#8B949E]" />
            <select
              value={empresaActiva}
              onChange={e => { setEmpresa(e.target.value); setSelectedDiv(''); setNewDiv(''); setNewSubdiv('') }}
              className="input text-[12px] px-3 py-1.5"
            >
              {empresas.map(e => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Badge empresa activa */}
      <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-lg px-4 py-2.5">
        <Building2 size={14} className="text-blue-400" />
        <span className="text-[12px] text-blue-300 font-medium">
          Configurando unidades de negocio de: <span className="text-blue-200">{empresaActiva}</span>
        </span>
        <span className="ml-auto text-[11px] text-blue-400/60">
          {divisiones.length} unidades de negocio · {vehiculos.length} equipos
        </span>
      </div>

      {/* Usuarios */}
      <UsuariosConfig />

      {/* Grid de dos columnas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* ── Columna izquierda: Divisiones ──────────────────────────────── */}
        <div className="bg-[#161B22] border border-white/[0.07] rounded-xl overflow-hidden">

          {/* Header */}
          <div className="px-5 py-4 border-b border-white/[0.07]">
            <div className="flex items-center gap-2">
              <Shield size={15} className="text-[#8B949E]" />
              <h2 className="text-[14px] font-semibold text-[#E6EDF3]">Unidades de negocio</h2>
              <span className="ml-auto text-[11px] text-[#6E7681]">{divisiones.length} total</span>
            </div>
          </div>

          {/* Lista */}
          <div className="divide-y divide-white/[0.05]">
            {divisiones.length === 0 && (
              <div className="px-5 py-8 text-center text-[12px] text-[#6E7681]">
                No hay unidades de negocio configuradas para {empresaActiva}. Agrega la primera.
              </div>
            )}

            {divisiones.map(div => {
              const count = vehiculosPorDiv[div] ?? 0
              const subs = subdivisiones[div] ?? []
              const canDelete = count === 0

              return (
                <div key={div} className="px-5 py-3 flex items-start gap-3 group">
                  <div className={`w-3 h-3 rounded-full mt-0.5 shrink-0 ${divColor(div)}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-[#E6EDF3]">{div}</span>
                      <span className="text-[10px] text-[#6E7681]">
                        {count} {count === 1 ? 'equipo' : 'equipos'}
                      </span>
                    </div>
                    {subs.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {subs.map(s => (
                          <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-[#8B949E]">{s}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="relative group/del">
                    <button
                      onClick={() => handleDeleteDiv(div)}
                      disabled={!canDelete || delDiv.isPending}
                      className={`p-1 rounded transition-colors ${
                        canDelete
                          ? 'text-[#6E7681] hover:text-red-400 hover:bg-red-500/10'
                          : 'text-[#6E7681]/30 cursor-not-allowed'
                      }`}
                      title={canDelete ? 'Eliminar unidad de negocio' : `No se puede eliminar: ${count} equipos asignados`}
                    >
                      <X size={14} />
                    </button>
                    {!canDelete && (
                      <div className="absolute right-0 top-full mt-1 w-48 bg-[#1C2333] border border-white/[0.1] rounded-md px-2.5 py-1.5 text-[10px] text-[#8B949E] opacity-0 group-hover/del:opacity-100 transition-opacity pointer-events-none z-10 whitespace-nowrap">
                        No se puede eliminar: {count} equipos asignados
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Formulario agregar */}
          <div className="px-5 py-4 border-t border-white/[0.07]">
            <div className="flex gap-2">
              <input
                className="input flex-1"
                placeholder="Nueva unidad de negocio..."
                value={newDiv}
                onChange={e => { setNewDiv(e.target.value); setDivError('') }}
                maxLength={50}
                onKeyDown={e => e.key === 'Enter' && handleAddDiv()}
              />
              <button className="btn btn-primary" onClick={handleAddDiv} disabled={addDiv.isPending}>
                {addDiv.isPending ? (
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Plus size={14} />
                )}
                Agregar
              </button>
            </div>
            {divError && <p className="text-[11px] text-red-400 mt-1.5">{divError}</p>}
            {addDiv.isError && <p className="text-[11px] text-red-400 mt-1.5">Error al agregar la unidad de negocio.</p>}
          </div>
        </div>

        {/* ── Columna derecha: Subdivisiones ─────────────────────────────── */}
        <div className="bg-[#161B22] border border-white/[0.07] rounded-xl overflow-hidden">

          <div className="px-5 py-4 border-b border-white/[0.07]">
            <div className="flex items-center gap-2 mb-3">
              <Shield size={15} className="text-[#8B949E]" />
              <h2 className="text-[14px] font-semibold text-[#E6EDF3]">Subdivisiones</h2>
            </div>
            {divisiones.length > 0 ? (
              <select
                className="input w-full"
                value={activeDivForSub}
                onChange={e => { setSelectedDiv(e.target.value); setSubdivError('') }}
              >
                {divisiones.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            ) : (
              <p className="text-[11px] text-[#6E7681]">Crea una unidad de negocio primero para gestionar subdivisiones.</p>
            )}
          </div>

          {divisiones.length > 0 && (
            <>
              <div className="divide-y divide-white/[0.05]">
                {currentSubdivs.length === 0 && (
                  <div className="px-5 py-8 text-center text-[12px] text-[#6E7681]">
                    No hay subdivisiones para <span className="font-medium text-[#8B949E]">{activeDivForSub}</span>
                  </div>
                )}
                {currentSubdivs.map(sub => (
                  <div key={sub} className="px-5 py-2.5 flex items-center gap-3 group">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#8B949E]/50 shrink-0" />
                    <span className="text-[13px] text-[#E6EDF3] flex-1">{sub}</span>
                    <button
                      onClick={() => handleDeleteSubdiv(sub)}
                      disabled={delSubdiv.isPending}
                      className="p-1 rounded text-[#6E7681] hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                      title="Eliminar subdivision"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="px-5 py-4 border-t border-white/[0.07]">
                <div className="flex gap-2">
                  <input
                    className="input flex-1"
                    placeholder={`Nueva subdivision para ${activeDivForSub}...`}
                    value={newSubdiv}
                    onChange={e => { setNewSubdiv(e.target.value); setSubdivError('') }}
                    maxLength={50}
                    onKeyDown={e => e.key === 'Enter' && handleAddSubdiv()}
                  />
                  <button className="btn btn-primary" onClick={handleAddSubdiv} disabled={addSubdiv.isPending}>
                    {addSubdiv.isPending ? (
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Plus size={14} />
                    )}
                    Agregar
                  </button>
                </div>
                {subdivError && <p className="text-[11px] text-red-400 mt-1.5">{subdivError}</p>}
                {addSubdiv.isError && <p className="text-[11px] text-red-400 mt-1.5">Error al agregar la subdivision.</p>}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Tarifas de rutas ──────────────────────────────────────────────── */}
      <TarifasConfig />
    </div>
  )
}

// ── Componente de Usuarios ──────────────────────────────────────────────────

function UsuariosConfig() {
  const qc = useQueryClient()
  const { user: currentUser } = useAuth()
  const { data: empresas = [] } = useEmpresas()

  const { data: usuarios = [], isLoading } = useQuery<Usuario[]>({
    queryKey: ['usuarios'],
    queryFn: () => api.usuarios.list(),
    staleTime: 30_000,
  })

  const [showAdd, setShowAdd] = useState(false)
  const [editUser, setEditUser] = useState<Usuario | null>(null)
  const [pwUser, setPwUser] = useState<Usuario | null>(null)

  // ── Crear usuario ─────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: (data: { username: string; password: string; nombre: string; rol: string; empresa?: string }) =>
      api.usuarios.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['usuarios'] }); setShowAdd(false) },
  })

  // ── Editar usuario ────────────────────────────────────────────────────────
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { nombre?: string; rol?: string; empresa?: string | null; activo?: boolean } }) =>
      api.usuarios.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['usuarios'] }); setEditUser(null) },
  })

  // ── Cambiar password ──────────────────────────────────────────────────────
  const pwMut = useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) =>
      api.usuarios.changePassword(id, password),
    onSuccess: () => setPwUser(null),
  })

  // ── Toggle activo ─────────────────────────────────────────────────────────
  function toggleActivo(u: Usuario) {
    if (u.id === currentUser?.id) return
    updateMut.mutate({ id: u.id, data: { activo: !u.activo } })
  }

  return (
    <>
      {/* Modales */}
      {showAdd && (
        <UsuarioFormModal
          empresas={empresas}
          isPending={createMut.isPending}
          isError={createMut.isError}
          onClose={() => setShowAdd(false)}
          onSave={(data) => createMut.mutate(data)}
        />
      )}
      {editUser && (
        <UsuarioEditModal
          usuario={editUser}
          empresas={empresas}
          isPending={updateMut.isPending}
          isError={updateMut.isError}
          onClose={() => setEditUser(null)}
          onSave={(data) => updateMut.mutate({ id: editUser.id, data })}
        />
      )}
      {pwUser && (
        <PasswordModal
          usuario={pwUser}
          isPending={pwMut.isPending}
          isError={pwMut.isError}
          onClose={() => setPwUser(null)}
          onSave={(password) => pwMut.mutate({ id: pwUser.id, password })}
        />
      )}

      <div className="bg-[#161B22] border border-white/[0.07] rounded-xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.07]">
          <div className="flex items-center gap-2">
            <Users size={15} className="text-blue-400" />
            <h2 className="text-[14px] font-semibold text-[#E6EDF3]">Usuarios del sistema</h2>
            <span className="ml-auto text-[11px] text-[#6E7681]">{usuarios.length} usuarios</span>
            <button className="btn btn-primary text-[11px] px-3 py-1.5 ml-2" onClick={() => setShowAdd(true)}>
              <Plus size={12} /> Nuevo usuario
            </button>
          </div>
        </div>

        {/* Tabla */}
        {isLoading ? (
          <div className="px-5 py-8 text-center text-[12px] text-[#6E7681]">Cargando usuarios...</div>
        ) : usuarios.length === 0 ? (
          <div className="px-5 py-8 text-center text-[12px] text-[#6E7681]">No hay usuarios configurados.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[#6E7681] text-[10px] uppercase tracking-wider bg-[#0D1117]/40">
                  <th className="p-2.5 pl-5">Usuario</th>
                  <th className="p-2.5">Nombre</th>
                  <th className="p-2.5">Rol</th>
                  <th className="p-2.5">Empresa</th>
                  <th className="p-2.5">Estado</th>
                  <th className="p-2.5">Ultimo login</th>
                  <th className="p-2.5 w-32">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {usuarios.map(u => {
                  const isSelf = u.id === currentUser?.id
                  return (
                    <tr key={u.id} className="hover:bg-white/[0.02] group">
                      <td className="p-2.5 pl-5 font-mono font-medium text-[#E6EDF3]">{u.username}</td>
                      <td className="p-2.5 text-[#E6EDF3]">{u.nombre}</td>
                      <td className="p-2.5">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          u.rol === 'admin'
                            ? 'bg-purple-500/15 text-purple-400 border border-purple-500/20'
                            : 'bg-blue-500/15 text-blue-400 border border-blue-500/20'
                        }`}>
                          {u.rol === 'admin' ? 'Admin' : 'Empresa'}
                        </span>
                      </td>
                      <td className="p-2.5 text-[#8B949E]">{u.empresa ?? '—'}</td>
                      <td className="p-2.5">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${u.activo ? 'text-emerald-400' : 'text-red-400'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${u.activo ? 'bg-emerald-400' : 'bg-red-400'}`} />
                          {u.activo ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className="p-2.5 text-[#6E7681]">
                        {u.ultimo_login
                          ? new Date(u.ultimo_login).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
                          : 'Nunca'}
                      </td>
                      <td className="p-2.5">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setEditUser(u)}
                            className="p-1 rounded text-[#6E7681] hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                            title="Editar usuario"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={() => setPwUser(u)}
                            className="p-1 rounded text-[#6E7681] hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                            title="Cambiar contrasena"
                          >
                            <Key size={12} />
                          </button>
                          {!isSelf && (
                            <button
                              onClick={() => toggleActivo(u)}
                              disabled={updateMut.isPending}
                              className={`p-1 rounded transition-colors ${
                                u.activo
                                  ? 'text-[#6E7681] hover:text-red-400 hover:bg-red-500/10'
                                  : 'text-[#6E7681] hover:text-emerald-400 hover:bg-emerald-500/10'
                              }`}
                              title={u.activo ? 'Desactivar' : 'Activar'}
                            >
                              {u.activo ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
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

// ── Modal: Nuevo usuario ────────────────────────────────────────────────────

function UsuarioFormModal({ empresas, isPending, isError, onClose, onSave }: {
  empresas: string[]
  isPending: boolean
  isError: boolean
  onClose: () => void
  onSave: (data: { username: string; password: string; nombre: string; rol: string; empresa?: string }) => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [nombre, setNombre]     = useState('')
  const [rol, setRol]           = useState<'admin' | 'empresa'>('empresa')
  const [empresa, setEmpresa]   = useState('')
  const [err, setErr]           = useState('')

  function handleSave() {
    if (!username.trim()) { setErr('Ingrese un nombre de usuario'); return }
    if (!password.trim() || password.length < 4) { setErr('La contrasena debe tener al menos 4 caracteres'); return }
    if (!nombre.trim()) { setErr('Ingrese el nombre completo'); return }
    if (rol === 'empresa' && !empresa) { setErr('Seleccione una empresa'); return }
    setErr('')
    onSave({
      username: username.trim(),
      password,
      nombre: nombre.trim(),
      rol,
      ...(rol === 'empresa' ? { empresa } : {}),
    })
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-[#161B22] border border-white/[0.12] rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
          <h2 className="text-[14px] font-semibold">Nuevo usuario</h2>
          <button onClick={onClose} className="text-[#6E7681] hover:text-[#E6EDF3] transition-colors"><X size={16} /></button>
        </div>
        <div className="p-5 flex flex-col gap-3">
          <label className="block">
            <span className="text-[11px] text-[#8B949E] mb-1 block uppercase tracking-wider">Usuario</span>
            <input className="input w-full" value={username} onChange={e => { setUsername(e.target.value); setErr('') }} placeholder="nombre.usuario" autoFocus />
          </label>
          <label className="block">
            <span className="text-[11px] text-[#8B949E] mb-1 block uppercase tracking-wider">Contrasena</span>
            <input type="password" className="input w-full" value={password} onChange={e => { setPassword(e.target.value); setErr('') }} placeholder="********" />
          </label>
          <label className="block">
            <span className="text-[11px] text-[#8B949E] mb-1 block uppercase tracking-wider">Nombre completo</span>
            <input className="input w-full" value={nombre} onChange={e => { setNombre(e.target.value); setErr('') }} placeholder="Juan Perez" />
          </label>
          <label className="block">
            <span className="text-[11px] text-[#8B949E] mb-1 block uppercase tracking-wider">Rol</span>
            <select className="input w-full" value={rol} onChange={e => { setRol(e.target.value as any); setErr('') }}>
              <option value="admin">Admin</option>
              <option value="empresa">Empresa</option>
            </select>
          </label>
          {rol === 'empresa' && (
            <label className="block">
              <span className="text-[11px] text-[#8B949E] mb-1 block uppercase tracking-wider">Empresa</span>
              <select className="input w-full" value={empresa} onChange={e => { setEmpresa(e.target.value); setErr('') }}>
                <option value="">Seleccionar empresa...</option>
                {empresas.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </label>
          )}
          {err && <p className="text-[11px] text-red-400 mt-1">{err}</p>}
          {isError && <p className="text-[11px] text-red-400">Error al crear usuario.</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-white/[0.07]">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={isPending}>
            {isPending ? 'Creando...' : 'Crear usuario'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal: Editar usuario ───────────────────────────────────────────────────

function UsuarioEditModal({ usuario, empresas, isPending, isError, onClose, onSave }: {
  usuario: Usuario
  empresas: string[]
  isPending: boolean
  isError: boolean
  onClose: () => void
  onSave: (data: { nombre?: string; rol?: string; empresa?: string | null }) => void
}) {
  const [nombre, setNombre] = useState(usuario.nombre)
  const [rol, setRol]       = useState<'admin' | 'empresa'>(usuario.rol)
  const [empresa, setEmpresa] = useState(usuario.empresa ?? '')

  function handleSave() {
    onSave({
      nombre: nombre.trim(),
      rol,
      empresa: rol === 'empresa' ? empresa : null,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-[#161B22] border border-white/[0.12] rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
          <div>
            <h2 className="text-[14px] font-semibold">Editar usuario</h2>
            <p className="text-[11px] text-[#6E7681] mt-0.5 font-mono">{usuario.username}</p>
          </div>
          <button onClick={onClose} className="text-[#6E7681] hover:text-[#E6EDF3] transition-colors"><X size={16} /></button>
        </div>
        <div className="p-5 flex flex-col gap-3">
          <label className="block">
            <span className="text-[11px] text-[#8B949E] mb-1 block uppercase tracking-wider">Nombre completo</span>
            <input className="input w-full" value={nombre} onChange={e => setNombre(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-[11px] text-[#8B949E] mb-1 block uppercase tracking-wider">Rol</span>
            <select className="input w-full" value={rol} onChange={e => setRol(e.target.value as any)}>
              <option value="admin">Admin</option>
              <option value="empresa">Empresa</option>
            </select>
          </label>
          {rol === 'empresa' && (
            <label className="block">
              <span className="text-[11px] text-[#8B949E] mb-1 block uppercase tracking-wider">Empresa</span>
              <select className="input w-full" value={empresa} onChange={e => setEmpresa(e.target.value)}>
                <option value="">Seleccionar empresa...</option>
                {empresas.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </label>
          )}
          {isError && <p className="text-[11px] text-red-400">Error al actualizar usuario.</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-white/[0.07]">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={isPending}>
            {isPending ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal: Cambiar contrasena ───────────────────────────────────────────────

function PasswordModal({ usuario, isPending, isError, onClose, onSave }: {
  usuario: Usuario
  isPending: boolean
  isError: boolean
  onClose: () => void
  onSave: (password: string) => void
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [err, setErr]           = useState('')

  function handleSave() {
    if (!password.trim() || password.length < 4) { setErr('Minimo 4 caracteres'); return }
    if (password !== confirm) { setErr('Las contrasenas no coinciden'); return }
    setErr('')
    onSave(password)
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-[#161B22] border border-white/[0.12] rounded-xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
          <div>
            <h2 className="text-[14px] font-semibold">Cambiar contrasena</h2>
            <p className="text-[11px] text-[#6E7681] mt-0.5 font-mono">{usuario.username}</p>
          </div>
          <button onClick={onClose} className="text-[#6E7681] hover:text-[#E6EDF3] transition-colors"><X size={16} /></button>
        </div>
        <div className="p-5 flex flex-col gap-3">
          <label className="block">
            <span className="text-[11px] text-[#8B949E] mb-1 block uppercase tracking-wider">Nueva contrasena</span>
            <input type="password" className="input w-full" value={password} onChange={e => { setPassword(e.target.value); setErr('') }} autoFocus />
          </label>
          <label className="block">
            <span className="text-[11px] text-[#8B949E] mb-1 block uppercase tracking-wider">Confirmar contrasena</span>
            <input type="password" className="input w-full" value={confirm} onChange={e => { setConfirm(e.target.value); setErr('') }} />
          </label>
          {err && <p className="text-[11px] text-red-400">{err}</p>}
          {isError && <p className="text-[11px] text-red-400">Error al cambiar contrasena.</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-white/[0.07]">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={isPending}>
            {isPending ? 'Guardando...' : 'Cambiar contrasena'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Componente de Tarifas ───────────────────────────────────────────────────

function TarifasConfig() {
  const qc = useQueryClient()
  const { data: geocercas = [] } = useGeocercas()
  const { data: tarifas = [], isLoading } = useTarifas()

  const nombresGeocerca = useMemo(() => {
    const set = new Set<string>()
    for (const g of geocercas) set.add(g.nombre.trim())
    return [...set].sort()
  }, [geocercas])

  const [origen, setOrigen] = useState('')
  const [destino, setDestino] = useState('')
  const [precio, setPrecio] = useState('')
  const [error, setError] = useState('')
  const [filtro, setFiltro] = useState('')

  const addTarifa = useMutation({
    mutationFn: (data: { origen: string; destino: string; precio: number }) =>
      http.post('/tarifas', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tarifas'] })
      setOrigen('')
      setDestino('')
      setPrecio('')
      setError('')
    },
  })

  const delTarifa = useMutation({
    mutationFn: (id: number) => http.delete(`/tarifas/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tarifas'] }),
  })

  function handleAdd() {
    if (!origen) { setError('Selecciona un origen'); return }
    if (!destino) { setError('Selecciona un destino'); return }
    if (!precio || isNaN(Number(precio)) || Number(precio) <= 0) { setError('Ingresa un precio válido'); return }
    if (origen === destino) { setError('Origen y destino deben ser diferentes'); return }
    setError('')
    addTarifa.mutate({ origen, destino, precio: Number(precio) })
  }

  const tarifasFiltradas = filtro
    ? tarifas.filter(t =>
        t.origen.toLowerCase().includes(filtro.toLowerCase()) ||
        t.destino.toLowerCase().includes(filtro.toLowerCase())
      )
    : tarifas

  return (
    <div className="bg-[#161B22] border border-white/[0.07] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/[0.07]">
        <div className="flex items-center gap-2">
          <DollarSign size={15} className="text-amber-400" />
          <h2 className="text-[14px] font-semibold text-[#E6EDF3]">Tarifas por ruta</h2>
          <span className="ml-auto text-[11px] text-[#6E7681]">{tarifas.length} tarifas</span>
        </div>
        <p className="text-[11px] text-[#6E7681] mt-1">
          Precio de combustible por viaje segun origen y destino (geocercas de RedGPS)
        </p>
      </div>

      {/* Formulario agregar */}
      <div className="px-5 py-4 border-b border-white/[0.07] bg-[#0D1117]/30">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[160px]">
            <label className="text-[10px] text-[#6E7681] uppercase tracking-wider mb-1 block">Origen</label>
            <select value={origen} onChange={e => { setOrigen(e.target.value); setError('') }}
              className="input w-full text-[12px]">
              <option value="">Seleccionar geocerca...</option>
              {nombresGeocerca.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <ArrowRight size={16} className="text-[#6E7681] mb-2" />
          <div className="flex-1 min-w-[160px]">
            <label className="text-[10px] text-[#6E7681] uppercase tracking-wider mb-1 block">Destino</label>
            <select value={destino} onChange={e => { setDestino(e.target.value); setError('') }}
              className="input w-full text-[12px]">
              <option value="">Seleccionar geocerca...</option>
              {nombresGeocerca.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="w-32">
            <label className="text-[10px] text-[#6E7681] uppercase tracking-wider mb-1 block">Precio ($)</label>
            <input
              type="number"
              className="input w-full text-[12px]"
              placeholder="0"
              value={precio}
              onChange={e => { setPrecio(e.target.value); setError('') }}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <button className="btn btn-primary mb-0" onClick={handleAdd} disabled={addTarifa.isPending}>
            {addTarifa.isPending ? (
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Plus size={14} />
            )}
            Agregar
          </button>
        </div>
        {error && <p className="text-[11px] text-red-400 mt-1.5">{error}</p>}
        {addTarifa.isError && <p className="text-[11px] text-red-400 mt-1.5">Error al guardar la tarifa</p>}
      </div>

      {/* Filtro */}
      {tarifas.length > 5 && (
        <div className="px-5 py-2 border-b border-white/[0.07]">
          <input
            type="text"
            placeholder="Buscar geocerca..."
            value={filtro}
            onChange={e => setFiltro(e.target.value)}
            className="input w-full text-[12px]"
          />
        </div>
      )}

      {/* Tabla de tarifas */}
      {isLoading ? (
        <p className="px-5 py-8 text-center text-[12px] text-[#6E7681]">Cargando tarifas...</p>
      ) : tarifas.length === 0 ? (
        <p className="px-5 py-8 text-center text-[12px] text-[#6E7681]">
          No hay tarifas configuradas. Agrega la primera usando los selectores de geocerca.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[#6E7681] text-[10px] uppercase tracking-wider bg-[#0D1117]/40">
                <th className="p-2.5 pl-5">Origen</th>
                <th className="p-2.5"></th>
                <th className="p-2.5">Destino</th>
                <th className="p-2.5 text-right">Precio</th>
                <th className="p-2.5 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {tarifasFiltradas.map(t => (
                <tr key={t.id} className="hover:bg-white/[0.02] group">
                  <td className="p-2.5 pl-5 font-medium text-[#E6EDF3]">{t.origen}</td>
                  <td className="p-2.5 text-[#6E7681]"><ArrowRight size={12} /></td>
                  <td className="p-2.5 font-medium text-[#E6EDF3]">{t.destino}</td>
                  <td className="p-2.5 text-right text-amber-400 font-semibold">
                    ${t.precio.toLocaleString('es-AR')}
                  </td>
                  <td className="p-2.5 pr-5">
                    <button
                      onClick={() => delTarifa.mutate(t.id)}
                      disabled={delTarifa.isPending}
                      className="p-1 rounded text-[#6E7681] hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                      title="Eliminar tarifa"
                    >
                      <X size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
