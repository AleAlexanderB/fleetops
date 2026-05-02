// Resolución de la URL del Hub AB para SSO obligatorio.
// 1. VITE_HUB_URL (build-time) — override explícito
// 2. Subdominio "fleetops.*" → reemplaza por "hub.*" (HTTPS prod nip.io)
// 3. Fallback: mismo host + puerto 3200 (HTTP IP-direct, dev local)

export function resolverHubUrl(): string {
  const envUrl = (import.meta as any).env?.VITE_HUB_URL
  if (envUrl) return envUrl
  if (typeof window === 'undefined') return 'http://localhost:3200'
  const proto = window.location.protocol
  const host  = window.location.hostname
  for (const prefix of ['fleetops.', 'equipos.', 'rrhh.', 'obras.']) {
    if (host.startsWith(prefix)) return `${proto}//hub.${host.slice(prefix.length)}`
  }
  return `${proto}//${host}:3200`
}

export function redirigirAlHub(): void {
  if (typeof window === 'undefined') return
  window.location.replace(resolverHubUrl().replace(/\/$/, '') + '/')
}
