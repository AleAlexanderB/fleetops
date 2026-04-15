import { Outlet, Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Login from '../../pages/Login'

export default function AuthGate() {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0f1117] flex items-center justify-center">
        <div className="flex items-center gap-3 text-[#8B949E] text-[13px]">
          <div className="w-5 h-5 border-2 border-[#8B949E] border-t-transparent rounded-full animate-spin" />
          Verificando sesion...
        </div>
      </div>
    )
  }

  if (!user) {
    return <Login />
  }

  return <Outlet />
}
