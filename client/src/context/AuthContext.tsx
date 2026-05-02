import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { api } from '../api/api'
import { redirigirAlHub } from '../lib/hubUrl'

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface User {
  id: number
  username: string
  nombre: string
  rol: 'admin' | 'empresa'
  empresa: string | null
}

export interface AuthContextType {
  user: User | null
  token: string | null
  isAdmin: boolean
  isLoading: boolean
  logout: () => void
}

const TOKEN_KEY    = 'fleetops_token'
const HUB_TOKEN_PARAM = 'hub_token'

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  isAdmin: false,
  isLoading: true,
  logout: () => {},
})

export const useAuth = () => useContext(AuthContext)

// ── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(localStorage.getItem(TOKEN_KEY))
  const [isLoading, setIsLoading] = useState(true)

  const isAdmin = user?.rol === 'admin'

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setUser(null)
    redirigirAlHub()
  }, [])

  // Validar token al montar
  // Prioridad: 1) hub_token en URL (login desde el hub), 2) token guardado en localStorage
  // ADR-007: si no hay sesión válida, redirigir al Hub (no hay login local)
  useEffect(() => {
    const params   = new URLSearchParams(window.location.search)
    const hubToken = params.get(HUB_TOKEN_PARAM)

    if (hubToken) {
      localStorage.setItem(TOKEN_KEY, hubToken)
      params.delete(HUB_TOKEN_PARAM)
      const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '')
      window.history.replaceState({}, '', newUrl)
    }

    const stored = localStorage.getItem(TOKEN_KEY)
    if (!stored) {
      redirigirAlHub()
      return
    }

    api.auth.me()
      .then((data: { user: User }) => {
        setUser(data.user)
        setToken(stored)
        setIsLoading(false)
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY)
        redirigirAlHub()
      })
  }, [])

  return (
    <AuthContext.Provider value={{ user, token, isAdmin, isLoading, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
