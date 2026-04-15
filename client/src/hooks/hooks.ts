/**
 * hooks.ts
 * TanStack Query hooks para todos los datos del sistema.
 * v9: Multi-empresa — hooks aceptan empresa param para filtrar por cuenta RedGPS.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api, type Vehiculo, type Alerta } from '../api/api'

// ── Status ────────────────────────────────────────────────────────────────────

export function useStatus() {
  return useQuery({
    queryKey: ['status'],
    queryFn: api.status,
    refetchInterval: 30_000,
    retry: false,
  })
}

// ── Empresas ──────────────────────────────────────────────────────────────────

export function useEmpresas() {
  return useQuery({
    queryKey: ['empresas'],
    queryFn: api.empresas,
    staleTime: Infinity,   // no cambian en runtime
  })
}

// ── Vehiculos ─────────────────────────────────────────────────────────────────

export function useVehiculos(params?: { division?: string; subgrupo?: string; estado?: string; empresa?: string }) {
  return useQuery({
    queryKey: ['vehiculos', params],
    queryFn: () => api.vehiculos(params),
    refetchInterval: 30_000,
    staleTime: 25_000,
  })
}

export function useResumenDivision(params?: { empresa?: string }) {
  return useQuery({
    queryKey: ['resumen-division', params],
    queryFn: () => api.resumenDivision(params),
    refetchInterval: 30_000,
    staleTime: 25_000,
  })
}

// ── Geocercas ─────────────────────────────────────────────────────────────────

export function useGeocercas(params?: { empresa?: string }) {
  return useQuery({
    queryKey: ['geocercas', params],
    queryFn: () => api.geocercas(params),
    refetchInterval: 60_000,
    staleTime: 55_000,
  })
}

// ── Viajes libres ─────────────────────────────────────────────────────────────

export function useViajesLibres(params?: { division?: string; subgrupo?: string; patente?: string; empresa?: string }) {
  return useQuery({
    queryKey: ['viajes-libres', params],
    queryFn: () => api.viajesLibres(params),
    refetchInterval: 30_000,
    staleTime: 25_000,
  })
}

export function useViajesLibresHistorico(params: {
  desde?: string; hasta?: string; patente?: string
  codigoEquipo?: string; division?: string; subgrupo?: string
  page?: number; pageSize?: number
}, enabled = true) {
  return useQuery({
    queryKey: ['viajes-libres-historico', params],
    queryFn: () => api.viajesLibresHistorico(params),
    enabled,
    staleTime: 60_000,
  })
}

export function useViajesProgramadosHistorico(params: {
  desde?: string; hasta?: string; patente?: string
  codigoEquipo?: string; division?: string; estado?: string
  page?: number; pageSize?: number; empresa?: string
}, enabled = true) {
  return useQuery({
    queryKey: ['viajes-programados-historico', params],
    queryFn: () => api.viajesProgramadosHistorico(params),
    enabled,
    staleTime: 60_000,
  })
}

// ── Divisiones ────────────────────────────────────────────────────────────────

export function useDivisionesValidas(empresa?: string) {
  return useQuery({
    queryKey: ['divisiones-validas', empresa],
    queryFn: () => api.divisionesValidas(empresa),
    staleTime: Infinity,
  })
}

export function useSetDivision() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ codigo, division, subgrupo }: { codigo: string; division: string; subgrupo?: string }) =>
      api.setDivision(codigo, division, subgrupo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehiculos'] })
      qc.invalidateQueries({ queryKey: ['resumen-division'] })
    },
  })
}

// ── En taller (override manual) ──────────────────────────────────────────────

export function useSetEnTaller() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ codigo, enTaller }: { codigo: string; enTaller: boolean }) =>
      api.setEnTaller(codigo, enTaller),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehiculos'] })
    },
  })
}

// ── Alertas ──────────────────────────────────────────────────────────────────

export function useAlertas(params: {
  tipo?: string; codigoEquipo?: string; empresa?: string; division?: string
  geocerca?: string; desde?: string; hasta?: string; leida?: string
  page?: number; pageSize?: number
}, enabled = true) {
  return useQuery({
    queryKey: ['alertas', params],
    queryFn: () => api.alertas(params),
    enabled,
    refetchInterval: 30_000,
    staleTime: 25_000,
  })
}

export function useAlertasResumen(params?: { empresa?: string; desde?: string; hasta?: string }) {
  return useQuery({
    queryKey: ['alertas-resumen', params],
    queryFn: () => api.alertasResumen(params),
    refetchInterval: 30_000,
    staleTime: 25_000,
  })
}

export function useAlertasRanking(params?: { empresa?: string; desde?: string; hasta?: string; tipo?: string }) {
  return useQuery({
    queryKey: ['alertas-ranking', params],
    queryFn: () => api.alertasRanking(params),
    refetchInterval: 60_000,
    staleTime: 55_000,
  })
}

export function useMarcarAlertasLeidas() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[] | 'all') => api.marcarAlertasLeidas(ids),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alertas'] })
      qc.invalidateQueries({ queryKey: ['alertas-resumen'] })
    },
  })
}

// ── Informes de rendimiento ──────────────────────────────────────────────────

export function useInformeVehiculos(params: { desde?: string; hasta?: string; division?: string; empresa?: string }, enabled = true) {
  return useQuery({
    queryKey: ['informe-vehiculos', params],
    queryFn: () => api.informeVehiculos(params),
    enabled,
    staleTime: 60_000,
  })
}

export function useInformeChoferes(params: { desde?: string; hasta?: string; division?: string; empresa?: string }, enabled = true) {
  return useQuery({
    queryKey: ['informe-choferes', params],
    queryFn: () => api.informeChoferes(params),
    enabled,
    staleTime: 60_000,
  })
}

export function useLiquidacion(params: { desde?: string; hasta?: string; division?: string; chofer?: string; empresa?: string }, enabled = true) {
  return useQuery({
    queryKey: ['liquidacion', params],
    queryFn: () => api.liquidacion(params),
    enabled,
    staleTime: 60_000,
  })
}

export function useTarifas() {
  return useQuery({
    queryKey: ['tarifas'],
    queryFn: api.tarifas,
    staleTime: Infinity,
  })
}

// ── SSE — Posiciones en tiempo real ───────────────────────────────────────────

export interface PosicionSSE {
  unitPlate: string | null
  idgps:     string | null
  codigo:    string | null
  etiqueta:  string | null
  empresa:   string | null    // v9: empresa del vehiculo
  latitud:   number
  longitud:  number
  velocidad: number
  ignicion:  number
  geocerca:  string | null
  conductor: string | null
  timestamp: string
}

export function usePosicionesSSE() {
  const [posiciones, setPosiciones] = useState<PosicionSSE[]>([])
  const [conectado, setConectado]   = useState(false)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const baseUrl = import.meta.env.VITE_API_URL ?? ''
    const apiKey  = import.meta.env.VITE_API_KEY ?? ''
    const token   = localStorage.getItem('fleetops_token')
    const url     = `${baseUrl}/api/posiciones/stream?token=${token ?? ''}${apiKey ? `&apikey=${apiKey}` : ''}`

    function conectar() {
      if (esRef.current) esRef.current.close()

      const es = new EventSource(url)
      esRef.current = es

      es.onopen = () => setConectado(true)

      es.onmessage = (e) => {
        try {
          const { type, data } = JSON.parse(e.data)
          if (type === 'posiciones') setPosiciones(data)
        } catch { /* ignorar mensajes malformados */ }
      }

      es.onerror = () => {
        setConectado(false)
        es.close()
        setTimeout(conectar, 5_000)
      }
    }

    conectar()
    return () => { esRef.current?.close() }
  }, [])

  return { posiciones, conectado }
}

// ── Helpers de UI ─────────────────────────────────────────────────────────────

export function estadoLabel(estado: Vehiculo['estado']) {
  const map: Record<string, string> = {
    en_ruta:            'En ruta',
    detenido_encendido: 'Detenido',
    inactivo:           'Inactivo',
    alerta:             'Alerta',
    desconocido:        'Sin datos',
    en_taller:          'En taller',
  }
  return map[estado] ?? estado
}

export function estadoBadgeClass(estado: Vehiculo['estado']) {
  const map: Record<string, string> = {
    en_ruta:            'badge-green',
    detenido_encendido: 'badge-amber',
    inactivo:           'badge-gray',
    alerta:             'badge-red',
    desconocido:        'badge-gray',
    en_taller:          'badge-orange',
  }
  return map[estado] ?? 'badge-gray'
}

export function divisionClass(division: string | null) {
  const map: Record<string, string> = {
    'Hormigon':    'dv-h',
    'Agregados':   'dv-a',
    'Premoldeados':'dv-p',
    'Obras':       'dv-o',
    'Logistica':   'dv-l',
    'Corralon':    'dv-c',
    'Taller':      'dv-t',
  }
  return division ? (map[division] ?? 'badge-gray') : 'badge-gray'
}

export function formatDuracion(min: number | null) {
  if (min === null) return '—'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export function formatTS(ts: string | null) {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
  } catch { return ts }
}
