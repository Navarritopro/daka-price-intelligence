"use client";

export type ActiveFilter = {
  key: string;
  label: string;
  onRemove: () => void;
};

export default function FilterFeedback({
  filters,
  visible,
  total,
  loading,
  onClear
}: {
  filters: ActiveFilter[];
  visible: number;
  total: number;
  loading: boolean;
  onClear: () => void;
}) {
  return <div className="filter-feedback" aria-live="polite">
    <div className="filter-result-summary">
      <strong>{loading ? "Actualizando resultados…" : `${visible.toLocaleString("es-VE")} de ${total.toLocaleString("es-VE")} resultados visibles`}</strong>
      <span>{filters.length ? `${filters.length} criterio${filters.length === 1 ? "" : "s"} aplicado${filters.length === 1 ? "" : "s"}` : "Sin filtros adicionales"}</span>
    </div>
    {filters.length > 0 && <div className="active-filter-list" aria-label="Filtros activos">
      {filters.map((filter) => <button type="button" key={filter.key} onClick={filter.onRemove} aria-label={`Quitar filtro ${filter.label}`}>
        <span>{filter.label}</span><b aria-hidden="true">×</b>
      </button>)}
      <button type="button" className="clear-active-filters" onClick={onClear}>Limpiar filtros</button>
    </div>}
  </div>;
}
