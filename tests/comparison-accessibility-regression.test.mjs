import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../components/competitor-comparison.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function luminance(hex) {
  const channels = hex.match(/\w\w/g).map((value) => Number.parseInt(value, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test("las pestañas exponen selección y navegación completa por teclado", () => {
  assert.match(component, /role="tablist"/);
  assert.match(component, /role="tab"/);
  assert.match(component, /aria-selected=/);
  assert.match(component, /aria-controls=/);
  for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
    assert.match(component, new RegExp(`event\\.key === "${key}"`));
  }
});

test("los filtros tienen etiquetas visibles asociadas a cada control", () => {
  for (const label of ["Buscar producto", "Marca", "Categoría", "Posición competitiva", "Ordenar resultados"]) {
    assert.match(component, new RegExp(`<span>${label}</span>`));
  }
  assert.ok((component.match(/className="comparison-field"/g) ?? []).length >= 5);
});

test("la tabla mantiene contexto semántico y operación con teclado", () => {
  assert.match(component, /<caption className="sr-only">/);
  assert.ok((component.match(/scope="col"/g) ?? []).length >= 5);
  assert.match(component, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(component, /aria-current=/);
  assert.match(component, /Tabla desplazable de productos comparados/);
});

test("la posición competitiva no depende solamente del color", () => {
  assert.match(component, /symbol: "↓", text: "Ventaja DAKA"/);
  assert.match(component, /symbol: "↑", text: `Ventaja \$\{competitorName\}`/);
  assert.match(component, /symbol: "=", text: "Precio igual"/);
  assert.match(component, /comparison-direction/);
});

test("el foco, zoom y preferencias del usuario están contemplados", () => {
  assert.match(styles, /\.competitor-comparison :is\(button,a,input,select,\[tabindex="0"\]\):focus-visible/);
  assert.match(styles, /min-height:44px/);
  assert.match(styles, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(styles, /@media\(forced-colors:active\)/);
  assert.match(styles, /@media\(max-width:700px\)/);
});

test("los colores aprobados conservan contraste AA para texto normal", () => {
  const pairs = [
    ["003288", "FFCD00"],
    ["FFFFFF", "B53112"],
    ["FFFFFF", "053AED"],
    ["10223D", "05ED6D"],
    ["10223D", "73A851"],
    ["10223D", "29B6F6"]
  ];
  for (const [foreground, background] of pairs) {
    assert.ok(contrast(foreground, background) >= 4.5, `${foreground} sobre ${background} debe alcanzar 4.5:1`);
  }
});

test("las funciones aprobadas del Comparador permanecen presentes", () => {
  for (const fragment of [
    "/api/comparison?",
    "setMode(\"review\")",
    "setMode(\"manage\")",
    "Cargar 50 comparaciones más",
    "CompetitorHistory",
    "FilterFeedback"
  ]) assert.ok(component.includes(fragment), `Debe conservar ${fragment}`);
});
