import { createBrowserRouter, Navigate } from 'react-router-dom'
import Layout              from './components/layout/Layout'
import AuthGate            from './components/layout/AuthGate'
import AdminGuard          from './components/layout/AdminGuard'
import Dashboard           from './pages/Dashboard'
import Equipos             from './pages/Equipos'
import Geocercas           from './pages/Geocercas'
import ViajesLibres        from './pages/ViajesLibres'
import ViajesProgramados   from './pages/ViajesProgramados'
import Informes            from './pages/Informes'
import Alertas             from './pages/Alertas'
import Configuracion       from './pages/Configuracion'

export const router = createBrowserRouter([
  {
    path:    '/',
    element: <AuthGate />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true,                    element: <Dashboard /> },
          { path: 'equipos',               element: <Equipos /> },
          { path: 'geocercas',             element: <Geocercas /> },
          { path: 'viajes/libres',         element: <ViajesLibres /> },
          { path: 'viajes/programados',    element: <ViajesProgramados /> },
          { path: 'informes',              element: <Informes /> },
          { path: 'alertas',               element: <Alertas /> },
          { path: 'configuracion',         element: <AdminGuard><Configuracion /></AdminGuard> },
        ],
      },
    ],
  },
])
