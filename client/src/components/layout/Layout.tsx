import { useState, useEffect, createContext, useContext } from 'react'
import { NavLink, Outlet, Navigate } from 'react-router-dom'
import { LayoutDashboard, Truck, Hexagon, ArrowUpRight, ClipboardList, BarChart2, Bell, Settings, ChevronDown, Building2, LogOut, Home } from 'lucide-react'
import { useStatus, usePosicionesSSE, useEmpresas } from '../../hooks/hooks'
import { useAuth } from '../../context/AuthContext'

// ── Contexto global de empresa ──────────────────────────────────────────────
// Permite que todas las paginas accedan a la empresa seleccionada

interface EmpresaContextType {
  empresa: string         // '' = Todas las empresas
  setEmpresa: (e: string) => void
}

const EmpresaCtx = createContext<EmpresaContextType>({ empresa: '', setEmpresa: () => {} })
export const useEmpresa = () => useContext(EmpresaCtx)

const NAV = [
  { to: '/',                  icon: LayoutDashboard, label: 'Dashboard',      adminOnly: false },
  { to: '/equipos',           icon: Truck,           label: 'Equipos',        adminOnly: false },
  { to: '/geocercas',         icon: Hexagon,         label: 'Geocercas',      adminOnly: false },
  { to: '/viajes/libres',     icon: ArrowUpRight,    label: 'Viajes libres',  adminOnly: false },
  { to: '/viajes/programados',icon: ClipboardList,   label: 'Programados',    adminOnly: false },
  { to: '/informes',          icon: BarChart2,        label: 'Informes',       adminOnly: false },
  { to: '/alertas',           icon: Bell,             label: 'Alertas',        adminOnly: false },
  { to: '/configuracion',     icon: Settings,         label: 'Configuracion',  adminOnly: true  },
]

export default function Layout() {
  const { user, isAdmin, logout } = useAuth()
  const { data: status }   = useStatus()
  const { conectado }      = usePosicionesSSE()
  const { data: empresas } = useEmpresas()
  const [empresa, setEmpresa] = useState('')

  // Para usuarios empresa: forzar su empresa automáticamente
  useEffect(() => {
    if (user && user.rol === 'empresa' && user.empresa) {
      setEmpresa(user.empresa)
    }
  }, [user])

  const tokenOk = status?.redgps?.tokenPresente ?? false

  // Si usuario es empresa, no mostrar selector
  const multiEmpresa = isAdmin && (empresas?.length ?? 0) > 1

  // Filtrar nav items por rol
  const navItems = NAV.filter(item => !item.adminOnly || isAdmin)

  return (
    <EmpresaCtx.Provider value={{ empresa, setEmpresa }}>
      <div className="flex flex-col h-screen overflow-hidden">

        {/* ── Header ─────────────────────────────────────────────── */}
        <header className="h-[52px] bg-brand flex items-center px-5 gap-4 shrink-0 border-b border-black/30 z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-white/15 rounded-lg flex items-center justify-center text-[11px] font-bold text-white">
              AB
            </div>
            <div>
              <p className="text-[13px] font-semibold text-white leading-none">AB CONSTRUCCIONES</p>
              <p className="text-[10px] text-white/60 leading-none mt-0.5">Sistema Integrado de Gestion</p>
            </div>
          </div>

          <div className="w-px h-7 bg-white/20 mx-1" />

          <div className="flex items-center gap-2 bg-black/20 rounded-lg px-3 py-1.5">
            <div className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="text-[13px] font-semibold text-white">FleetOPS</span>
          </div>

          {/* Selector de empresa */}
          {multiEmpresa && (
            <div className="relative">
              <div className="flex items-center gap-1.5">
                <Building2 size={13} className="text-white/60" />
                <select
                  value={empresa}
                  onChange={e => setEmpresa(e.target.value)}
                  className="appearance-none bg-white/10 border border-white/20 rounded-md px-3 py-1.5 pr-7 text-[11px] text-white outline-none cursor-pointer hover:bg-white/15 transition-colors"
                >
                  <option value="" className="bg-[#1E4FAB] text-white">Todas las empresas</option>
                  {empresas?.map(e => (
                    <option key={e} value={e} className="bg-[#1E4FAB] text-white">{e}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-white/60 pointer-events-none" />
              </div>
            </div>
          )}

          {/* Botón Home → vuelve al hub principal */}
          <a
            href={window.location.origin.replace(/:\d+$/, ':3200')}
            title="Volver al inicio — AB Construcciones"
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/15 hover:bg-white/25 text-white font-medium transition-colors text-[12px] border border-white/20"
          >
            <Home size={14} />
            <span>Inicio</span>
          </a>

          {/* Status RedGPS */}
          <div className="flex items-center gap-2 text-[11px] text-white/70">
            <div className={`w-2 h-2 rounded-full ${tokenOk ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
            {tokenOk
              ? (conectado ? 'RedGPS · SSE conectado' : 'RedGPS · reconectando...')
              : 'RedGPS · sin token'}
          </div>

          <div className="w-px h-7 bg-white/20 mx-1" />

          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-bold text-white">
              {user?.nombre ? user.nombre.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase() : '??'}
            </div>
            <div>
              <span className="text-[12px] text-white/85">{user?.nombre ?? 'Usuario'}</span>
              {user?.rol === 'empresa' && user.empresa && (
                <p className="text-[9px] text-white/50 leading-none mt-0.5">{user.empresa}</p>
              )}
            </div>
            <button
              onClick={logout}
              className="ml-1 p-1.5 rounded-md hover:bg-white/10 text-white/60 hover:text-white transition-colors"
              title="Cerrar sesion"
            >
              <LogOut size={14} />
            </button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">

          {/* ── Sidebar ────────────────────────────────────────────── */}
          <nav className="w-[200px] bg-[#161B22] border-r border-white/[0.07] flex flex-col shrink-0 overflow-y-auto">
            <div className="p-3 pt-4">
              {navItems.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] mb-0.5 transition-colors
                     ${isActive
                       ? 'bg-brand/15 text-brand-light border-l-2 border-brand-light pl-[9px]'
                       : 'text-[#8B949E] hover:bg-[#1C2333] hover:text-[#E6EDF3]'}`
                  }
                >
                  <Icon size={15} className="shrink-0" />
                  {label}
                </NavLink>
              ))}
            </div>

            {/* Sync status + filtro activo */}
            <div className="mt-auto p-3 border-t border-white/[0.07]">
              {empresa && (
                <div className="flex items-center gap-2 bg-blue-500/10 rounded-md px-2.5 py-2 mb-2 text-[10px] text-blue-300">
                  <Building2 size={11} className="shrink-0" />
                  <span className="truncate">{empresa}</span>
                  {isAdmin && (
                    <button
                      onClick={() => setEmpresa('')}
                      className="ml-auto text-blue-400 hover:text-white shrink-0"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2 bg-[#1C2333] rounded-md px-2.5 py-2 text-[11px] text-[#8B949E]">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                Polling cada 30s
              </div>
            </div>
          </nav>

          {/* ── Contenido ──────────────────────────────────────────── */}
          <main className="flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </EmpresaCtx.Provider>
  )
}
