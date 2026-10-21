"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { brandKey, distinctBrands, MAX_SELECTED_BRANDS } from "@/lib/opportunity-brand-selection";

type Props = {
  options: string[];
  selected: string[];
  onChange: (brands: string[]) => void;
};

export default function OpportunityBrandFilter({ options, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const visible = useMemo(() => options.filter((brand) => brandKey(brand).includes(brandKey(search))), [options, search]);
  const selectedKeys = new Set(selected.map(brandKey));

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const toggle = (brand: string) => {
    const key = brandKey(brand);
    if (!selectedKeys.has(key) && selected.length >= MAX_SELECTED_BRANDS) return;
    onChange(selectedKeys.has(key) ? selected.filter((value) => brandKey(value) !== key) : [...selected, brand]);
  };

  return <div className="opportunity-brand-filter" ref={rootRef} onKeyDown={(event) => {
    if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); triggerRef.current?.focus(); }
  }}>
    <button ref={triggerRef} type="button" className="opportunity-brand-trigger" aria-label="Filtrar por marcas" aria-haspopup="dialog" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((value) => !value)}>
      <span>{selected.length === 0 ? "Todas las marcas" : selected.length === 1 ? selected[0] : `${selected.length} marcas seleccionadas`}</span><span aria-hidden="true">⌄</span>
    </button>
    {selected.length > 0 && <div className="opportunity-brand-selection" aria-live="polite">
      <span>{selected.slice(0, 2).join(" · ")}{selected.length > 2 ? ` · +${selected.length - 2}` : ""}</span>
      <button type="button" onClick={() => onChange([])} aria-label="Limpiar marcas seleccionadas">Limpiar</button>
    </div>}
    {open && <div id={menuId} className="opportunity-brand-menu" role="dialog" aria-label="Seleccionar marcas">
      <label htmlFor={`${menuId}-search`}>Buscar marcas</label>
      <input id={`${menuId}-search`} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Escribe una marca" autoFocus/>
      <div className="opportunity-brand-menu-actions">
        <button type="button" onClick={() => onChange(distinctBrands([...selected, ...visible]).slice(0, MAX_SELECTED_BRANDS))} disabled={visible.length === 0}>Seleccionar visibles</button>
        <button type="button" onClick={() => onChange([])} disabled={selected.length === 0}>Limpiar</button>
      </div>
      <div className="opportunity-brand-options" role="group" aria-label="Marcas disponibles">
        {visible.length ? visible.map((brand) => <label key={brand}>
          <input type="checkbox" checked={selectedKeys.has(brandKey(brand))} disabled={selected.length >= MAX_SELECTED_BRANDS && !selectedKeys.has(brandKey(brand))} onChange={() => toggle(brand)}/><span>{brand}</span>
        </label>) : <p>No hay marcas que coincidan.</p>}
      </div>
      <small>{selected.length === 0 ? "Sin filtro de marca" : `${selected.length} ${selected.length === 1 ? "marca seleccionada" : "marcas seleccionadas"}`}{selected.length >= MAX_SELECTED_BRANDS ? ` · límite de ${MAX_SELECTED_BRANDS}` : ""}</small>
    </div>}
  </div>;
}
