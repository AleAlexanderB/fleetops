/**
 * api.ts
 * Todas las llamadas al backend FleetOPS.
 * El frontend NUNCA llama a RedGPS directamente.
 * v2: agrega codigoEquipo/etiqueta en vehículos y endpoints históricos con rango de fechas.
 */

import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL ?? ''

const API_KEY = import.meta.env.VITE_API_KEY ?? ''

export const http = axios.create({
  baseURL: `${BASE}/api`,
  timeout: 10_000,
  headers: API_KEY ? { 'X-Api-Key': API_KEY } : {},
})

// ── Interceptor: JWT en Authorization header ─────────────────────────────────

http.interceptors.request.use(config => {
  const token = localStorage.getItem('fleetops_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── Interceptor: 401 → limpiar token y redirigir al Hub (ADR-007) ───────────

import { redirigirAlHub } from '../lib/hubUrl'

http.interceptors.response.use(
  res => res,
  error => {
    if (error.response?.status === 401) {
      localStorage.removeItem('fleetops_token')
      redirigirAlHub()
    }
    return Promise.reject(error)
  }
)

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface Vehiculo {
  id: number
  codigo: string              // identificador principal: "A021", "K006", etc.
  patente: string | null      // puede ser null para maquinaria sin patente
  etiqueta: string            // display: patente si existe, codigo si no
  codigoEquipo: string | null // alias de codigo para compatibilidad
  tienePatente: boolean
  nombre: string
  marca: string | null
  modelo: string | null
  empresa: string             // v9: nombre de la empresa RedGPS
  division: string | null
  subgrupo: string | null
  chofer: { id: number; nombre: string } | null
  conductor: string | null
  estado: 'en_ruta' | 'detenido_encendido' | 'inactivo' | 'alerta' | 'desconocido' | 'en_taller'
  velocidad: number
  latitud: number | null
  longitud: number | null
  geocercaActual: string | null
  ultimaActualizacion: string | null
}

export interface Geocerca {
  idCerca: number
  nombre: string
  tipoCerca: number   // 1=Poligonal, 2=Circular, 3=Lineal
  radio: number
  visible: boolean
  empresa: string     // v9: nombre de la empresa RedGPS
  division: string | null
  subgrupo: string | null
  ingresosHoy: number
  salidasHoy: number
  equiposDentro: string[]
}

export interface ViajeLibre {
  id: number
  patente: string
  etiqueta: string            // v2: patente o idgps
  codigoEquipo: string | null // v2
  chofer: string | null
  division: string | null
  subgrupo: string | null
  geocercaOrigen:  { idCerca: number; nombre: string } | null
  geocercaDestino: { idCerca: number; nombre: string } | null
  timestampInicio: string
  timestampFin: string | null
  duracionMin: number | null
  kmRecorridos: number | null
  estado: 'en_curso' | 'completado' | 'en_transito'
}

export interface ResumenDia {
  completados: number
  enCurso: number
  total: number
  kmTotal: number
}

export interface ResumenDivision {
  [division: string]: {
    total: number
    en_ruta: number
    detenido: number
    inactivo: number
    alerta: number
    subgrupos: { [sub: string]: number }
  }
}

export interface HistoricoResult<T> {
  ok: boolean
  data: T[]
  total: number
  page: number
  pageSize: number
  source: 'mysql' | 'memory'
}

export interface Alerta {
  id: number
  tipo: string
  tipoLabel: string
  codigoEquipo: string | null
  patente: string | null
  etiqueta: string | null
  empresa: string | null
  division: string | null
  descripcion: string | null
  geocerca: string | null
  latitud: number | null
  longitud: number | null
  velocidad: number | null
  conductor: string | null
  timestampAlerta: string
  creadoEn: string
  leida: boolean
}

export interface InformeVehiculo {
  codigo: string
  patente: string | null
  division: string | null
  subgrupo: string | null
  totalViajes: number
  totalKm: number
  promedioKm: number
  totalMinutos: number
  promedioDuracion: number
  diasActivo: number
  primerViaje: string
  ultimoViaje: string
  choferesDistintos: number
  choferes: string
  viajesPorDia: number
  kmPorDia: number
}

export interface InformeChofer {
  chofer: string
  totalViajes: number
  totalKm: number
  promedioKm: number
  totalMinutos: number
  promedioDuracion: number
  diasActivo: number
  primerViaje: string
  ultimoViaje: string
  vehiculosDistintos: number
  vehiculos: string
  divisiones: string
  viajesPorDia: number
  kmPorDia: number
}

export interface ViajeConTarifa {
  id: number
  codigoEquipo: string | null
  patente: string | null
  chofer: string | null
  division: string | null
  subgrupo: string | null
  origen: string
  destino: string
  timestampInicio: string
  timestampFin: string | null
  duracionMin: number | null
  kmRecorridos: number | null
  precio: number | null
  tarifaMatch: string | null
}

export interface LiquidacionChofer {
  chofer: string
  viajes: ViajeConTarifa[]
  totalViajes: number
  totalKm: number
  totalPrecio: number
}

export interface Tarifa {
  id: number
  origen: string
  destino: string
  precio: number
  notas: string | null
}

export interface GeocercaTemp {
  id: number
  nombre: string
  latitud: number
  longitud: number
  radio: number
  viajeProgramadoId: number | null
  tipo: 'origen' | 'destino'
  activo: boolean
}

export interface ResumenAlertas {
  total: number
  noLeidas: number
  porTipo: { tipo: string; tipoLabel: string; cantidad: number }[]
}

export interface AlertaRanking {
  codigoEquipo: string
  etiqueta: string
  empresa: string | null
  totalAlertas: number
  porTipo: Record<string, number>
}

// ── Llamadas ──────────────────────────────────────────────────────────────────

// ── Tipos de usuario ─────────────────────────────────────────────────────────

export interface Usuario {
  id: number
  username: string
  nombre: string
  rol: 'admin' | 'empresa'
  empresa: string | null
  activo: boolean
  ultimo_login: string | null
}

export const api = {
  // ── Auth ────────────────────────────────────────────────────────────────────
  auth: {
    login: (username: string, password: string) =>
      http.post('/auth/login', { username, password }).then(r => r.data),
    me: () =>
      http.get('/auth/me').then(r => r.data),
  },

  // ── Usuarios ───────────────────────────────────────────────────────────────
  usuarios: {
    list: () =>
      http.get('/usuarios').then(r => r.data.data) as Promise<Usuario[]>,
    create: (data: { username: string; password: string; nombre: string; rol: string; empresa?: string }) =>
      http.post('/usuarios', data).then(r => r.data),
    update: (id: number, data: { nombre?: string; rol?: string; empresa?: string | null; activo?: boolean }) =>
      http.put(`/usuarios/${id}`, data).then(r => r.data),
    changePassword: (id: number, password: string) =>
      http.put(`/usuarios/${id}/password`, { password }).then(r => r.data),
    delete: (id: number) =>
      http.delete(`/usuarios/${id}`).then(r => r.data),
  },

  status: () =>
    http.get<{ ok: boolean; redgps: { tokenPresente: boolean } }>('/redgps/status').then(r => r.data),

  // v9: Lista de empresas configuradas
  empresas: () =>
    http.get<{ ok: boolean; data: string[] }>('/empresas').then(r => r.data.data),

  vehiculos: (params?: { division?: string; subgrupo?: string; estado?: string; empresa?: string }) =>
    http.get<{ ok: boolean; data: Vehiculo[] }>('/vehiculos', { params }).then(r => r.data.data),

  resumenDivision: (params?: { empresa?: string }) =>
    http.get<{ ok: boolean; data: ResumenDivision }>('/vehiculos/resumen', { params }).then(r => r.data.data),

  geocercas: (params?: { empresa?: string }) =>
    http.get<{ ok: boolean; data: Geocerca[] }>('/geocercas', { params }).then(r => r.data.data),

  // Dia actual (en memoria, inmediato)
  viajesLibres: (params?: { division?: string; subgrupo?: string; patente?: string; empresa?: string }) =>
    http.get<{ ok: boolean; resumen: ResumenDia; enCurso: ViajeLibre[]; completados: ViajeLibre[] }>(
      '/viajes/libres', { params }
    ).then(r => r.data),

  // Historico paginado en MySQL con rango de fechas
  viajesLibresHistorico: (params: {
    desde?: string; hasta?: string; patente?: string
    codigoEquipo?: string; division?: string; subgrupo?: string
    page?: number; pageSize?: number
  }) =>
    http.get<HistoricoResult<ViajeLibre>>('/viajes/libres/historico', { params }).then(r => r.data),

  // Historico paginado de programados en MySQL
  viajesProgramadosHistorico: (params: {
    desde?: string; hasta?: string; patente?: string
    codigoEquipo?: string; division?: string; estado?: string
    page?: number; pageSize?: number; empresa?: string
  }) =>
    http.get<HistoricoResult<any>>('/viajes/programados/historico', { params }).then(r => r.data),

  setEnTaller: (codigo: string, enTaller: boolean) =>
    http.put(`/vehiculos/${encodeURIComponent(codigo)}/taller`, { enTaller }).then(r => r.data),

  setDivision: (codigo: string, division: string, subgrupo?: string) =>
    http.put(`/divisiones/${encodeURIComponent(codigo)}`, { division, subgrupo }).then(r => r.data),

  divisionesValidas: (empresa?: string) =>
    http.get<{ ok: boolean; data: { divisiones: string[]; subdivisiones: Record<string, string[]>; subgruposObras: string[] } }>(
      '/divisiones/validas', { params: empresa ? { empresa } : {} }
    ).then(r => r.data.data),

  // ── Alertas ──────────────────────────────────────────────────────────────
  alertas: (params: {
    tipo?: string; codigoEquipo?: string; empresa?: string; division?: string
    geocerca?: string; desde?: string; hasta?: string; leida?: string
    page?: number; pageSize?: number
  }) =>
    http.get<{ ok: boolean; data: Alerta[]; total: number; page: number; pageSize: number }>(
      '/alertas', { params }
    ).then(r => r.data),

  alertasResumen: (params?: { empresa?: string; desde?: string; hasta?: string }) =>
    http.get<{ ok: boolean; data: ResumenAlertas }>('/alertas/resumen', { params }).then(r => r.data.data),

  alertasRanking: (params?: { empresa?: string; desde?: string; hasta?: string; tipo?: string }) =>
    http.get<{ ok: boolean; data: AlertaRanking[] }>('/alertas/ranking', { params }).then(r => r.data.data),

  marcarAlertasLeidas: (ids: number[] | 'all') =>
    http.post('/alertas/marcar-leidas', { ids }).then(r => r.data),

  // ── Informes de rendimiento ──────────────────────────────────────────────
  informeVehiculos: (params: { desde?: string; hasta?: string; division?: string; empresa?: string }) =>
    http.get<{ ok: boolean; data: InformeVehiculo[] }>('/informes/vehiculos', { params }).then(r => r.data.data),

  informeChoferes: (params: { desde?: string; hasta?: string; division?: string; empresa?: string }) =>
    http.get<{ ok: boolean; data: InformeChofer[] }>('/informes/choferes', { params }).then(r => r.data.data),

  liquidacion: (params: { desde?: string; hasta?: string; division?: string; chofer?: string; empresa?: string }) =>
    http.get<{ ok: boolean; data: LiquidacionChofer[]; totalViajes: number; totalKm: number; totalPrecio: number; viajesSinTarifa: number }>(
      '/informes/liquidacion', { params }
    ).then(r => r.data),

  tarifas: () =>
    http.get<{ ok: boolean; data: Tarifa[] }>('/tarifas').then(r => r.data.data),

  upsertTarifa: (data: { origen: string; destino: string; precio: number; notas?: string }) =>
    http.post('/tarifas', data).then(r => r.data),

  eliminarTarifa: (id: number) =>
    http.delete(`/tarifas/${id}`).then(r => r.data),

  // ── Geocercas temporales ────────────────────────────────────────────────
  geocercasTemp: () =>
    http.get<{ ok: boolean; data: GeocercaTemp[] }>('/geocercas/temp').then(r => r.data.data),

  crearGeocercaTemp: (data: { nombre: string; latitud: number; longitud: number; radio: number }) =>
    http.post('/geocercas/temp', data).then(r => r.data),

  eliminarGeocercaTemp: (id: number) =>
    http.delete(`/geocercas/temp/${id}`).then(r => r.data),
}
