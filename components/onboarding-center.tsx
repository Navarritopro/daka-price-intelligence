"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DriveStep } from "driver.js";
import {
  ONBOARDING_VERSION,
  type OnboardingStatus,
  type OnboardingTourKey
} from "@/lib/onboarding";

export type OnboardingNavigationTarget =
  | "explore"
  | "competitors"
  | "catalogChanges"
  | "comparison"
  | "opportunities"
  | "monitoring";

type Role = "admin" | "viewer";
type Progress = {
  tourKey: OnboardingTourKey;
  tourVersion: number;
  status: OnboardingStatus;
  lastStep: number;
  nextPromptAt: string | null;
};
type OnboardingPayload = {
  mode: "automatic" | "optional";
  version: number;
  progress: Progress[];
};
type HelpSection = {
  key: OnboardingTourKey;
  title: string;
  summary: string;
  details: string[];
  target: OnboardingNavigationTarget;
};

const HELP_SECTIONS: HelpSection[] = [
  {
    key: "general",
    title: "Primeros pasos",
    summary: "Conoce la estructura general de DAKA Price Lab.",
    details: ["Módulos principales", "Indicadores generales", "Filtros y ayuda contextual"],
    target: "explore"
  },
  {
    key: "daka",
    title: "Precios DAKA",
    summary: "Consulta catálogo, cambios e histórico por producto.",
    details: ["Precio anterior y actual", "Máximos y mínimos", "Disponibilidad y unidades reportadas"],
    target: "explore"
  },
  {
    key: "competitors",
    title: "Catálogos competencia",
    summary: "Explora precios y disponibilidad de cada competidor.",
    details: ["Damasco, Multimax, IVOO, Venelectronics y SoyTechno", "Cambios de precios", "Histórico de disponibilidad"],
    target: "competitors"
  },
  {
    key: "catalog_changes",
    title: "Cambios de catálogo",
    summary: "Audita productos ausentes, nuevos y recuperados entre capturas.",
    details: ["Comparación de capturas válidas", "Ausencias consecutivas", "Validación del enlace e histórico de presencia"],
    target: "catalogChanges"
  },
  {
    key: "comparison",
    title: "Comparador",
    summary: "Interpreta la posición de DAKA frente a productos equivalentes.",
    details: ["Brecha de precios", "Evolución competitiva", "Homologaciones y días con ventaja"],
    target: "comparison"
  },
  {
    key: "opportunities",
    title: "Oportunidades comerciales",
    summary: "Prioriza señales accionables de precio y disponibilidad.",
    details: ["Prioridades y brechas", "Exportación Excel/PDF", "Resumen por Telegram para administradores"],
    target: "opportunities"
  },
  {
    key: "monitoring",
    title: "Monitoreo técnico",
    summary: "Verifica el estado operativo de todas las fuentes.",
    details: ["Últimas ejecuciones", "Productos procesados", "Alertas y reporte diario"],
    target: "monitoring"
  }
];

const TOUR_TARGET: Record<OnboardingTourKey, OnboardingNavigationTarget> = {
  general: "explore",
  daka: "explore",
  competitors: "competitors",
  catalog_changes: "catalogChanges",
  comparison: "comparison",
  opportunities: "opportunities",
  monitoring: "monitoring"
};

function tourSteps(tour: OnboardingTourKey, role: Role): DriveStep[] {
  const adminText = role === "admin"
    ? "Como administrador también puedes iniciar procesos y acceder a acciones operativas."
    : "Tu perfil de consulta permite analizar la información sin ejecutar acciones administrativas.";

  const tours: Record<OnboardingTourKey, DriveStep[]> = {
    general: [
      { element: '[data-tour="module-nav"]', popover: { title: "Dos áreas principales", description: "Inteligencia de precios concentra el análisis comercial. Monitoreo técnico confirma que las capturas funcionan correctamente." } },
      { element: '[data-tour="dashboard-summary"]', popover: { title: "Resumen ejecutivo", description: "Estos indicadores presentan el catálogo DAKA, las oportunidades de rebaja, el precio promedio y la última ejecución exitosa." } },
      { element: '[data-tour="intelligence-tabs"]', popover: { title: "Módulos de análisis", description: "Desde aquí accedes al catálogo DAKA, históricos, competidores, comparador y oportunidades comerciales." } },
      { element: '[data-tour="catalog-filters"]', popover: { title: "Busca y filtra", description: "Combina nombre o código SAP con marca, estado y variación para reducir rápidamente el universo de productos." } },
      { element: '[data-tour="help-button"]', popover: { title: "Ayuda siempre disponible", description: `Puedes repetir este recorrido o abrir una guía específica para cualquier módulo. ${adminText}` } }
    ],
    daka: [
      { element: '[data-tour="intelligence-tabs"]', popover: { title: "Análisis DAKA", description: "Explorar precios muestra el catálogo actual; Cambios de precios muestra movimientos reales; Histórico conserva todas las capturas." } },
      { element: '[data-tour="catalog-filters"]', popover: { title: "Filtros transversales", description: "Busca por nombre o SAP y combina marca, vigencia y tipo de variación." } },
      { element: '[data-tour="daka-catalog-list"]', popover: { title: "Catálogo de productos", description: "Selecciona un producto para revisar su precio y comportamiento. El listado carga más resultados al desplazarte." } },
      { element: '[data-tour="daka-product-detail"]', popover: { title: "Detalle e histórico", description: "Aquí encontrarás precio actual, variación, gráfico, máximos, mínimos y capturas guardadas." } }
    ],
    competitors: [
      { element: '[data-tour="competitor-source-tabs"]', popover: { title: "Selecciona una fuente", description: "Consulta cada competidor de forma independiente o revisa conjuntamente los cambios de disponibilidad." } },
      { element: '[data-tour="competitor-subtabs"]', popover: { title: "Vistas del competidor", description: "Alterna entre catálogo, cambios de precios, histórico por producto y cambios de disponibilidad." } },
      { element: '[data-tour="competitor-filters"]', popover: { title: "Filtros del catálogo", description: "Filtra por marca, categoría, vigencia, stock y variación sin perder el histórico almacenado." } },
      { element: '[data-tour="competitor-content"]', popover: { title: "Producto e histórico", description: "La lista identifica la fuente, mientras el detalle muestra precio publicado, disponibilidad, unidades y capturas." } }
    ],
    catalog_changes: [
      { element: '[data-tour="catalog-changes-head"]', popover: { title: "Auditoría de presencia", description: "Compara capturas válidas de DAKA y sus competidores para encontrar productos ausentes, nuevos o recuperados." } },
      { element: '[data-tour="catalog-changes-filters"]', popover: { title: "Periodo y segmentación", description: "Compara ayer y hoy, las dos últimas capturas o fechas personalizadas; luego filtra por fuente, estado, marca y categoría." } },
      { element: '[data-tour="catalog-changes-table"]', popover: { title: "Validación producto a producto", description: "Abre el enlace original y consulta el historial. Una ausencia se confirma después de dos capturas consecutivas." } }
    ],
    comparison: [
      { element: '[data-tour="comparison-source-tabs"]', popover: { title: "Competidor analizado", description: "Selecciona la empresa contra la cual quieres evaluar la posición de DAKA." } },
      { element: '[data-tour="comparison-view-tabs"]', popover: { title: "Posición e histórico", description: "Posición actual compara la última captura; Histórico competitivo muestra cómo evolucionó la brecha." } },
      { element: '[data-tour="comparison-summary"]', popover: { title: "Indicadores competitivos", description: "Resume homologaciones, productos con mejor precio y comparaciones pendientes por validar." } },
      { element: '[data-tour="comparison-filters"]', popover: { title: "Segmenta el análisis", description: "Busca productos y filtra por marca, categoría, posición competitiva y orden de la brecha." } },
      { element: '[data-tour="comparison-grid"]', popover: { title: "Comparación producto a producto", description: "La tabla identifica DAKA y competencia; el detalle explica precio, disponibilidad, diferencia y confianza de la equivalencia." } }
    ],
    opportunities: [
      { element: '[data-tour="opportunity-head"]', popover: { title: "Centro de oportunidades", description: "Convierte señales de precio y disponibilidad en una lista priorizada para revisión comercial." } },
      { element: '[data-tour="opportunity-summary"]', popover: { title: "Lectura rápida", description: "Separa riesgos y ventajas de precio o disponibilidad, destacando las prioridades críticas y altas." } },
      { element: '[data-tour="opportunity-filters"]', popover: { title: "Criterios comerciales", description: "Filtra por competidor, marca, categoría, oportunidad, prioridad, disponibilidad y brecha mínima." } },
      { element: '[data-tour="opportunity-actions"]', popover: { title: "Comparte el análisis", description: role === "admin" ? "Descarga Excel o PDF y envía el reporte por Telegram con los filtros aplicados." : "Descarga el análisis autorizado en Excel o PDF con los filtros aplicados." } },
      { element: '[data-tour="opportunity-table"]', popover: { title: "Detalle de oportunidades", description: "Ordena por competencia o brecha y abre cada registro para revisar DAKA frente a todas sus equivalencias." } }
    ],
    monitoring: [
      { element: '[data-tour="monitoring-header"]', popover: { title: "Control operativo", description: `Aquí verificas si las fuentes terminaron correctamente y cuándo se actualizaron. ${adminText}` } },
      { element: '[data-tour="monitoring-source-tabs"]', popover: { title: "Estado por fuente", description: "Revisa el resumen general o entra en DAKA, Damasco, Multimax, IVOO, Venelectronics y SoyTechno." } },
      { element: '[data-tour="monitoring-summary"]', popover: { title: "Salud consolidada", description: "Las tarjetas alertan sobre fallas, capturas antiguas o disminuciones anormales del catálogo." } },
      { element: '[data-tour="monitoring-activity"]', popover: { title: "Trazabilidad", description: "Consulta inicio, finalización, origen, productos procesados, duración y resultado de cada ejecución." } }
    ]
  };
  return tours[tour];
}

function useModal(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleClose = () => onClose();
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);
  return ref;
}

export default function OnboardingCenter({
  role,
  onNavigate
}: {
  role: Role | null;
  onNavigate: (target: OnboardingNavigationTarget) => void;
}) {
  const [mode, setMode] = useState<"automatic" | "optional" | null>(null);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [showOptionalInvite, setShowOptionalInvite] = useState(false);
  const [search, setSearch] = useState("");
  const initialized = useRef(false);
  const helpButtonRef = useRef<HTMLButtonElement>(null);

  const closeWelcome = useCallback(() => setWelcomeOpen(false), []);
  const closeHelp = useCallback(() => {
    setHelpOpen(false);
    window.setTimeout(() => helpButtonRef.current?.focus(), 0);
  }, []);
  const welcomeRef = useModal(welcomeOpen, closeWelcome);
  const helpRef = useModal(helpOpen, closeHelp);

  const saveProgress = useCallback(async (
    tourKey: OnboardingTourKey,
    status: OnboardingStatus,
    lastStep = 0
  ) => {
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tourKey, status, lastStep })
      });
      if (!response.ok) return;
      const payload = await response.json();
      if (!payload.progress) return;
      setProgress((current) => [
        payload.progress,
        ...current.filter((item) => item.tourKey !== payload.progress.tourKey)
      ]);
    } catch {
      // La ayuda debe seguir disponible aunque no sea posible guardar el progreso.
    }
  }, []);

  useEffect(() => {
    if (!role || initialized.current) return;
    initialized.current = true;
    void fetch("/api/onboarding", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<OnboardingPayload> : null)
      .then((payload) => {
        if (!payload) return;
        setMode(payload.mode);
        setProgress(payload.progress);
        const general = payload.progress.find((item) => item.tourKey === "general" && item.tourVersion === payload.version);
        const promptDue = general?.status === "postponed" && (!general.nextPromptAt || new Date(general.nextPromptAt) <= new Date());
        if (payload.mode === "automatic" && (!general || general.status === "in_progress" || promptDue)) {
          setWelcomeOpen(true);
        } else if (payload.mode === "optional" && !general) {
          setShowOptionalInvite(true);
        }
      })
      .catch(() => undefined);
  }, [role]);

  const startTour = useCallback(async (tourKey: OnboardingTourKey) => {
    if (!role) return;
    const stored = progress.find((item) => item.tourKey === tourKey && item.tourVersion === ONBOARDING_VERSION);
    const resumeAt = stored?.status === "in_progress" ? stored.lastStep : 0;
    setWelcomeOpen(false);
    setHelpOpen(false);
    setShowOptionalInvite(false);
    onNavigate(TOUR_TARGET[tourKey]);
    await saveProgress(tourKey, "in_progress", resumeAt);
    await new Promise((resolve) => window.setTimeout(resolve, 450));

    const { driver } = await import("driver.js");
    const steps = tourSteps(tourKey, role);
    let completed = false;
    const tour = driver({
      steps,
      animate: true,
      smoothScroll: true,
      allowClose: true,
      allowKeyboardControl: true,
      skipMissingElement: true,
      waitForElement: 2500,
      overlayColor: "#07182b",
      overlayOpacity: 0.68,
      stagePadding: 8,
      stageRadius: 12,
      popoverClass: "daka-guided-tour",
      showProgress: true,
      progressText: "Paso {{current}} de {{total}}",
      nextBtnText: "Siguiente",
      prevBtnText: "Anterior",
      doneBtnText: "Finalizar",
      closeBtnLabel: "Cerrar recorrido",
      onNextClick: (_element, _step, options) => {
        const index = options.driver.getActiveIndex() ?? 0;
        if (options.driver.isLastStep()) {
          completed = true;
          void saveProgress(tourKey, "completed", index);
          options.driver.destroy();
          return;
        }
        void saveProgress(tourKey, "in_progress", index + 1);
        options.driver.moveNext();
      },
      onCloseClick: (_element, _step, options) => {
        const index = options.driver.getActiveIndex() ?? 0;
        void saveProgress(tourKey, "in_progress", index);
        options.driver.destroy();
      },
      onDestroyed: () => {
        if (completed) helpButtonRef.current?.focus();
      }
    });
    tour.drive(Math.min(resumeAt, Math.max(steps.length - 1, 0)));
  }, [onNavigate, progress, role, saveProgress]);

  const filteredSections = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("es");
    if (!normalized) return HELP_SECTIONS;
    return HELP_SECTIONS.filter((section) =>
      [section.title, section.summary, ...section.details].join(" ").toLocaleLowerCase("es").includes(normalized)
    );
  }, [search]);

  const dismissOptionalInvite = () => {
    setShowOptionalInvite(false);
    void saveProgress("general", "dismissed");
  };

  return <>
    <button
      ref={helpButtonRef}
      type="button"
      className="help-center-button"
      data-tour="help-button"
      aria-haspopup="dialog"
      onClick={() => setHelpOpen(true)}
    >
      <span aria-hidden="true">?</span> Ayuda
    </button>

    {showOptionalInvite && <aside className="onboarding-invite" role="status">
      <div><strong>¿Quieres conocer DAKA Price Lab?</strong><span>Realiza un recorrido breve sin afectar tu trabajo actual.</span></div>
      <button type="button" onClick={() => setWelcomeOpen(true)}>Conocer la plataforma</button>
      <button type="button" className="onboarding-invite-close" aria-label="Cerrar invitación" onClick={dismissOptionalInvite}>×</button>
    </aside>}

    <dialog ref={welcomeRef} className="onboarding-dialog" aria-labelledby="onboarding-welcome-title">
      <div className="onboarding-welcome-visual" aria-hidden="true"><span>DAKA</span><strong>PRICE LAB</strong></div>
      <div className="onboarding-welcome-content">
        <span className="eyebrow-dark">Recorrido inicial</span>
        <h2 id="onboarding-welcome-title">Bienvenido a DAKA Price Lab</h2>
        <p>Conoce cómo analizar precios, disponibilidad, competencia, oportunidades comerciales y el estado de las capturas.</p>
        <ul><li>Recorrido breve y guiado</li><li>Puedes cerrarlo en cualquier momento</li><li>La ayuda permanecerá disponible</li></ul>
        <div className="onboarding-dialog-actions">
          <button type="button" className="primary-button" onClick={() => void startTour("general")}>Comenzar recorrido</button>
          <button type="button" className="secondary-button" onClick={() => { setWelcomeOpen(false); void saveProgress("general", "dismissed"); }}>Explorar por mi cuenta</button>
          {mode === "automatic" && <button type="button" className="text-button" onClick={() => { setWelcomeOpen(false); void saveProgress("general", "postponed"); }}>Recordármelo en 7 días</button>}
        </div>
      </div>
    </dialog>

    <dialog ref={helpRef} className="help-center-dialog" aria-labelledby="help-center-title">
      <header className="help-center-head">
        <div><span className="eyebrow-dark">Ayuda contextual</span><h2 id="help-center-title">Centro de ayuda</h2><p>Selecciona un módulo para conocerlo paso a paso.</p></div>
        <button type="button" aria-label="Cerrar centro de ayuda" onClick={closeHelp}>×</button>
      </header>
      <div className="help-center-search"><label htmlFor="help-search">Buscar en la ayuda</label><input id="help-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ej. disponibilidad, Telegram, comparador"/></div>
      <div className="help-center-body">
        {filteredSections.map((section) => {
          const item = progress.find((entry) => entry.tourKey === section.key && entry.tourVersion === ONBOARDING_VERSION);
          return <article key={section.key} className="help-module-card">
            <div className="help-module-title"><div><h3>{section.title}</h3><p>{section.summary}</p></div>{item?.status === "completed" && <span>Completado</span>}</div>
            <ul>{section.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
            <button type="button" onClick={() => void startTour(section.key)}>{item?.status === "completed" ? "Repetir recorrido" : item?.status === "in_progress" ? "Continuar recorrido" : "Iniciar recorrido"}</button>
          </article>;
        })}
        {filteredSections.length === 0 && <div className="empty-state">No encontramos contenido de ayuda con esa búsqueda.</div>}
        <section className="help-role-note"><strong>Tu perfil: {role === "admin" ? "Administrador" : "Consulta"}</strong><p>{role === "admin" ? "La ayuda incluye acciones operativas, homologaciones, usuarios y envíos por Telegram." : "La ayuda se concentra en análisis y consulta; las acciones administrativas no se muestran como disponibles."}</p></section>
      </div>
    </dialog>
  </>;
}
