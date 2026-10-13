# Matriz de regresión funcional — Bloque 1

## Regla de protección

Las funcionalidades indicadas en esta matriz están aprobadas. Ninguna entrega puede eliminar columnas, filtros, cálculos, acciones o datos existentes sin una mejora previamente aprobada. Toda modificación debe conservar el resultado funcional y agregar su prueba correspondiente.

## Validaciones transversales obligatorias

| Código | Validación protegida | Criticidad | Evidencia mínima |
|---|---|---:|---|
| TR-01 | Inicio de sesión, sesión vigente y cierre de sesión | Crítica | Prueba automática y recorrido manual |
| TR-02 | Una respuesta vacía o no JSON muestra un error comprensible | Crítica | Prueba unitaria de cliente API |
| TR-03 | Los errores funcionales de la API conservan su mensaje | Crítica | Prueba unitaria de cliente API |
| TR-04 | Cancelar una consulta no muestra un error al usuario | Alta | Prueba de componente |
| TR-05 | Los filtros no mezclan resultados de consultas anteriores | Crítica | Prueba de integración |
| TR-06 | La fecha se interpreta en America/Caracas | Crítica | Prueba unitaria |
| TR-07 | DAKA y cada competidor conservan nombre y color aprobados | Alta | Comparación visual |
| TR-08 | Los estados de carga, vacío y error son distinguibles | Alta | Prueba de componente |
| TR-09 | Administradores y usuarios de consulta conservan sus permisos | Crítica | Prueba API y recorrido manual |
| TR-10 | Ninguna prueba o ejecución de validación escribe datos productivos | Crítica | Revisión de configuración |

## Funciones protegidas por módulo

| Módulo | Información/acciones que deben conservarse | Criticidad |
|---|---|---:|
| Resumen DAKA | Productos monitoreados, históricos, cambios, última ejecución y próxima ejecución | Crítica |
| Explorar precios DAKA | Nombre, SAP, categoría, marca, precio actual, variación, disponibilidad y presencia en última captura | Crítica |
| Cambios de precios | Periodo, fecha personalizada, precio inicial/final, diferencia, porcentaje, movimientos e histórico individual | Crítica |
| Catálogos competidores | Catálogo completo, búsqueda, marca, disponibilidad, precio, unidades reportadas e histórico | Crítica |
| Cambios de disponibilidad | Comparación entre las dos últimas ejecuciones exitosas, cantidad anterior/actual, diferencia y filtro sin variación | Crítica |
| Histórico de disponibilidad | Periodo personalizado, unidades, disponibilidad y detalle por producto | Crítica |
| Cambios de catálogo | Productos nuevos, ausentes, confirmados y recuperados; enlace externo e histórico de presencia | Crítica |
| Comparador | Producto DAKA y competidor, precios, brecha, posición, evolución, días con ventaja y periodo personalizado | Crítica |
| Histórico competitivo | Precio anterior/actual/mínimo/máximo, evolución, liderazgo y detalle temporal | Crítica |
| Oportunidades comerciales | Prioridad, competencia, brecha, filtros, ordenamiento, Excel, PDF y Telegram | Crítica |
| Maestro/Inventario DAKA | SKU, familia, línea, marca, descripción, cédula, estado, inventario consolidado y por ubicación | Crítica |
| Precios DAKA | Precio web, lista diaria, advertencias y conservación de valores originales | Crítica |
| Homologación competitiva | Cinco competidores, sugerencias, búsqueda manual, confirmación manual y No aplica con motivo | Crítica |
| Gestión de comparaciones | Actualizar, sustituir, desactivar, restaurar y auditar homologaciones | Crítica |
| Monitoreo técnico | Estado por fuente, ejecuciones, productos encontrados/guardados, duración, origen y errores | Alta |
| Telegram | Resumen por fuente, enlaces profundos, PDF de oportunidades y grupo configurado | Alta |
| Cargas de archivos | Vista previa, validación, aprobación, limpieza posterior y mensajes comprensibles | Crítica |
| Onboarding y ayuda | Recorrido inicial opcional, centro de ayuda y repetición de recorridos | Alta |
| Usuarios y cuenta | Alta, rol, activación, cambio de contraseña y protección administrativa | Crítica |

## Casos de datos que deben estar representados

- Producto con precio, sin precio y precio extremo advertido.
- Producto disponible, agotado, sin cantidad informada y con inventario negativo conservado.
- Producto nuevo, ausente una vez, ausente confirmado y recuperado.
- Variación de precio positiva, negativa y sin variación.
- Homologación confirmada, sugerida, sustituida, desactivada y marcada No aplica.
- SKU presente en Maestro sin inventario y SKU de inventario sin Maestro.
- Competidor con captura actual, atrasada, incompleta y fallida.
- Respuesta API correcta, vacía, inválida, 401, 403, 404, 429 y 5xx.

## Puerta de entrega

Antes de entregar cualquier paquete se debe ejecutar, como mínimo:

1. `npm run typecheck`.
2. `npm test`.
3. `npm run build`.
4. Pruebas Python cuando el entorno tenga instaladas todas las dependencias.
5. Revisión de archivos modificados para confirmar que el paquete conserva las carpetas originales.
6. Comparación contra esta matriz para detectar pérdida de columnas, filtros o acciones.
