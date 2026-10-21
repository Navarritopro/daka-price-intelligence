"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { distinctSelections, MAX_OPPORTUNITY_SELECTIONS, selectionKey } from "@/lib/opportunity-multi-selection";

type Option = { value: string; label: string };
type Props = {
  label: string;
  allLabel: string;
  options: Option[];
  selected: string[];
  onChange: (values: string[]) => void;
};

export default function OpportunityMultiFilter({ label, allLabel, options, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const visible = useMemo(() => options.filter((option) => selectionKey(option.label).includes(selectionKey(search))), [options, search]);
  const selectedKeys = new Set(selected.map(selectionKey));
  const selectedLabels = selected.map((value) => options.find((option) => selectionKey(option.value) === selectionKey(value))?.label ?? value);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const toggle = (value: string) => {
    const key = selectionKey(value);
    if (!selectedKeys.has(key) && selected.length >= MAX_OPPORTUNITY_SELECTIONS) return;
    onChange(selectedKeys.has(key) ? selected.filter((entry) => selectionKey(entry) !== key) : [...selected, value]);
  };

  return <div className="opportunity-brand-filter" ref={rootRef} onKeyDown={(event) => {
    if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); triggerRef.current?.focus(); }
  }}>
    <button ref={triggerRef} type="button" className="opportunity-brand-trigger" aria-label={`Filtrar por ${label.toLowerCase()}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((value) => !value)}>
      <span>{selected.length === 0 ? allLabel : selected.length === 1 ? selectedLabels[0] : `${selected.length} opciones de ${label.toLowerCase()}`}</span><span aria-hidden="true">⌄</span>
    </button>
    {selected.length > 0 && <div className="opportunity-brand-selection" aria-live="polite">
      <span>{selectedLabels.slice(0, 2).join(" · ")}{selected.length > 2 ? ` · +${selected.length - 2}` : ""}</span>
      <button type="button" onClick={() => onChange([])} aria-label={`Limpiar selección de ${label.toLowerCase()}`}>Limpiar</button>
    </div>}
    {open && <div id={menuId} className="opportunity-brand-menu" role="dialog" aria-label={`Seleccionar ${label.toLowerCase()}`}>
      <label htmlFor={`${menuId}-search`}>Buscar {label.toLowerCase()}</label>
      <input id={`${menuId}-search`} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Escribe para buscar`} autoFocus/>
      <div className="opportunity-brand-menu-actions">
        <button type="button" onClick={() => onChange(distinctSelections([...selected, ...visible.map((option) => option.value)]).slice(0, MAX_OPPORTUNITY_SELECTIONS))} disabled={visible.length === 0}>Seleccionar visibles</button>
        <button type="button" onClick={() => onChange([])} disabled={selected.length === 0}>Limpiar</button>
      </div>
      <div className="opportunity-brand-options" role="group" aria-label={`${label} disponibles`}>
        {visible.length ? visible.map((option) => <label key={option.value}>
          <input type="checkbox" checked={selectedKeys.has(selectionKey(option.value))} disabled={selected.length >= MAX_OPPORTUNITY_SELECTIONS && !selectedKeys.has(selectionKey(option.value))} onChange={() => toggle(option.value)}/><span>{option.label}</span>
        </label>) : <p>No hay opciones que coincidan.</p>}
      </div>
      <small>{selected.length === 0 ? `Sin filtro de ${label.toLowerCase()}` : `${selected.length} seleccionados`}</small>
    </div>}
  </div>;
}
