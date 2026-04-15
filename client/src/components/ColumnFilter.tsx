import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown, Filter } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ColumnFilterProps {
  /** Column title text */
  title: string
  /** All unique values for this column (displayed as checkbox options) */
  values: string[]
  /** Currently selected filter values (empty Set = show all / no filter) */
  selected: Set<string>
  /** Callback when the selection changes */
  onChange: (selected: Set<string>) => void
}

// ---------------------------------------------------------------------------
// Helper: compute unique values (sorted) from a list of items
// ---------------------------------------------------------------------------

export function uniqueValues<T>(
  items: T[],
  accessor: (item: T) => string | null | undefined,
): string[] {
  const seen = new Set<string>()
  for (const item of items) {
    const v = accessor(item)
    if (v != null && v !== '') seen.add(v)
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b))
}

// ---------------------------------------------------------------------------
// Hook: manage filter state for multiple columns at once
// ---------------------------------------------------------------------------

export function useColumnFilters<K extends string>(columns: K[]) {
  const [filters, setFilters] = useState<Record<K, Set<string>>>(() => {
    const init = {} as Record<K, Set<string>>
    for (const c of columns) init[c] = new Set<string>()
    return init
  })

  const setFilter = useCallback((column: K, values: Set<string>) => {
    setFilters((prev) => ({ ...prev, [column]: values }))
  }, [])

  const clearAll = useCallback(() => {
    setFilters((prev) => {
      const next = {} as Record<K, Set<string>>
      for (const k of Object.keys(prev) as K[]) next[k] = new Set<string>()
      return next
    })
  }, [])

  const isAnyActive = Object.values<Set<string>>(filters).some((s) => s.size > 0)

  return [filters, setFilter, clearAll, isAnyActive] as const
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ColumnFilter({ title, values, selected, onChange }: ColumnFilterProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const isActive = selected.size > 0

  const filtered = search
    ? values.filter((v) => v.toLowerCase().includes(search.toLowerCase()))
    : values

  const toggle = (value: string) => {
    if (selected.has(value)) {
      // Uncheck: remove from selection
      const next = new Set(selected)
      next.delete(value)
      onChange(next)
    } else {
      // Check: add to selection
      const next = new Set(selected)
      next.add(value)
      // If all are now selected, clear the filter (show all)
      onChange(next.size >= values.length ? new Set<string>() : next)
    }
  }

  // "Todos" = select all = clear filter (empty set = no filter = show all)
  const selectAll = () => { onChange(new Set<string>()); setOpen(false) }

  // "Limpiar" = also clear filter
  const clearSelection = () => { onChange(new Set<string>()); setOpen(false) }

  return (
    <div ref={containerRef} className="relative inline-flex items-center gap-1">
      {/* Clickable header area */}
      <button
        type="button"
        onClick={() => { setOpen((p) => !p); setSearch('') }}
        className={`inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider cursor-pointer select-none transition-colors ${
          isActive ? 'text-blue-400' : 'text-[#8B949E] hover:text-[#E6EDF3]'
        }`}
      >
        {title}
        {isActive ? (
          <Filter size={11} className="text-blue-400 shrink-0" />
        ) : (
          <ChevronDown size={11} className="shrink-0 opacity-60" />
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-40 min-w-[180px] max-w-[260px] rounded border border-white/[0.12] bg-[#161B22] shadow-lg"
        >
          {/* Search */}
          <div className="p-1.5 border-b border-white/[0.08]">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar..."
              autoFocus
              className="w-full bg-[#0D1117] border border-white/[0.12] rounded px-2 py-1 text-[11px] text-[#E6EDF3] placeholder:text-[#6E7681] outline-none focus:border-blue-500/50"
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 px-2 py-1 border-b border-white/[0.08]">
            <button
              type="button"
              onClick={selectAll}
              className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
            >
              Todos
            </button>
            <span className="text-[#6E7681] text-[10px]">|</span>
            <button
              type="button"
              onClick={clearSelection}
              className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
            >
              Limpiar
            </button>
            {isActive && (
              <span className="ml-auto text-[10px] text-[#6E7681]">
                {selected.size} de {values.length}
              </span>
            )}
          </div>

          {/* Value list */}
          <div className="max-h-[250px] overflow-y-auto py-0.5 scrollbar-thin">
            {filtered.length === 0 ? (
              <div className="px-2 py-2 text-[10px] text-[#6E7681] text-center">
                Sin resultados
              </div>
            ) : (
              filtered.map((value) => {
                // When no filter is active (size=0), show all as unchecked (no filter applied)
                // When filter is active, show checked only for selected items
                const checked = isActive ? selected.has(value) : false
                return (
                  <label
                    key={value}
                    className={`flex items-center gap-2 px-2 py-[3px] hover:bg-white/[0.04] cursor-pointer ${
                      isActive && !selected.has(value) ? 'opacity-40' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(value)}
                      className="accent-blue-500 w-3 h-3 shrink-0"
                    />
                    <span className="text-[11px] text-[#E6EDF3] truncate">
                      {value}
                    </span>
                  </label>
                )
              })
            )}
          </div>

          {/* Footer hint when no filter */}
          {!isActive && (
            <div className="px-2 py-1.5 border-t border-white/[0.08] text-[10px] text-[#6E7681] text-center">
              Seleccioná uno o más para filtrar
            </div>
          )}
        </div>
      )}
    </div>
  )
}
