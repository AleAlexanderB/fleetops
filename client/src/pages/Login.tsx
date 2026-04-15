import { useState, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!username.trim() || !password.trim()) {
      setError('Ingrese usuario y contrasena')
      return
    }
    setError('')
    setLoading(true)
    try {
      await login(username.trim(), password)
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? err?.message ?? 'Error al iniciar sesion'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo / Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2.5 bg-brand/15 rounded-xl px-5 py-3 mb-4">
            <div className="w-10 h-10 bg-brand rounded-lg flex items-center justify-center text-[13px] font-bold text-white">
              AB
            </div>
            <div className="text-left">
              <p className="text-[15px] font-bold text-white leading-none">FleetOPS</p>
              <p className="text-[10px] text-white/50 leading-none mt-0.5">AB Construcciones</p>
            </div>
          </div>
          <p className="text-[13px] text-[#8B949E]">Sistema Integrado de Gestion de Flota</p>
        </div>

        {/* Card */}
        <form
          onSubmit={handleSubmit}
          className="bg-[#161B22] border border-white/[0.07] rounded-xl p-6 flex flex-col gap-4"
        >
          <div>
            <label className="text-[11px] text-[#8B949E] uppercase tracking-wider mb-1.5 block">
              Usuario
            </label>
            <input
              type="text"
              className="input w-full"
              placeholder="nombre de usuario"
              value={username}
              onChange={e => { setUsername(e.target.value); setError('') }}
              autoFocus
              autoComplete="username"
            />
          </div>

          <div>
            <label className="text-[11px] text-[#8B949E] uppercase tracking-wider mb-1.5 block">
              Contrasena
            </label>
            <input
              type="password"
              className="input w-full"
              placeholder="********"
              value={password}
              onChange={e => { setPassword(e.target.value); setError('') }}
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5 text-[12px] text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary w-full justify-center py-2.5 mt-1"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Ingresando...
              </>
            ) : (
              'Iniciar sesion'
            )}
          </button>
        </form>

        <p className="text-center text-[11px] text-[#6E7681] mt-6">
          FleetOPS v2 &middot; Control de flota en tiempo real
        </p>
      </div>
    </div>
  )
}
