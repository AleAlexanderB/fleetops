import { useEffect } from 'react'
import { redirigirAlHub, resolverHubUrl } from '../lib/hubUrl'

// El login local de FleetOPS fue deprecado (ADR-007: Hub es dueño exclusivo de
// auth). Esta pantalla sólo aparece en transiciones — auto-redirige al Portal
// del Hub donde el usuario debe loguearse y volver vía el tile FleetOps (SSO).
export default function Login() {
  useEffect(() => {
    const id = setTimeout(redirigirAlHub, 50)
    return () => clearTimeout(id)
  }, [])

  return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-4">
      <div className="text-center">
        <div className="inline-flex items-center gap-2.5 bg-brand/15 rounded-xl px-5 py-3 mb-6">
          <div className="w-10 h-10 bg-brand rounded-lg flex items-center justify-center text-[13px] font-bold text-white">
            AB
          </div>
          <div className="text-left">
            <p className="text-[15px] font-bold text-white leading-none">FleetOPS</p>
            <p className="text-[10px] text-white/50 leading-none mt-0.5">AB Construcciones</p>
          </div>
        </div>
        <div className="flex items-center justify-center gap-3 text-[#8B949E] text-[13px]">
          <div className="w-4 h-4 border-2 border-[#8B949E] border-t-transparent rounded-full animate-spin" />
          Redirigiendo al Hub…
        </div>
        <p className="mt-4 text-[11px] text-[#6E7681]">
          El acceso a FleetOPS es a través del{' '}
          <a href={resolverHubUrl()} className="underline hover:text-white/80">Hub AB</a>.
        </p>
      </div>
    </div>
  )
}
