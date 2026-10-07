# Migración segura a DigitalOcean

Esta migración reemplaza Vercel y Neon sin borrar el origen hasta comprobar el nuevo entorno.

## Arquitectura elegida

- Aplicación: DigitalOcean App Platform, contenedor compartido de 512 MiB.
- Base: DigitalOcean Managed PostgreSQL, plan básico de 1 GiB RAM y 10 GiB de disco.
- Automatización: GitHub Actions permanece sin cambios; solo cambia su secreto `DATABASE_URL` al terminar.
- Región sugerida: New York para reducir latencia desde Venezuela y GitHub Actions.

## 1. Crear los recursos

1. Crear una cuenta en DigitalOcean y configurar PayPal u otro método aceptado.
2. Crear un proyecto llamado `daka-price-intelligence`.
3. Crear PostgreSQL administrado en el plan básico de 1 GiB y 10 GiB.
4. No ejecutar `db/schema.sql`: el workflow de migración copiará esquema, datos, índices y secuencias.
5. Crear una aplicación desde el repositorio GitHub `Navarritopro/daka-price-intelligence` y la rama `main`.
6. Elegir despliegue mediante el `Dockerfile` y el contenedor compartido de 512 MiB.
7. Configurar la ruta de salud `/api/health`.

## 2. Preparar la aplicación sin activarla

En App Platform configurar estas variables:

- `DATABASE_URL`: cadena de conexión de DigitalOcean PostgreSQL.
- `DATABASE_SSL=require`.
- `DATABASE_POOL_SIZE=5`.
- `ADMIN_API_KEY`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_WORKFLOW_FILE` y `GITHUB_TOKEN`: conservar los valores vigentes.

No publicar todavía el nuevo dominio como definitivo.

## 3. Congelar escrituras

Antes de copiar los datos, deshabilitar temporalmente los workflows programados de DAKA, Damasco, Multimax, IVOO, Venelectronics y SoyTechno. No ejecutar scrapers manuales durante la migración.

## 4. Copiar toda la base

En GitHub crear temporalmente dos secretos:

- `SOURCE_DATABASE_URL`: conexión actual de Neon.
- `TARGET_DATABASE_URL`: conexión nueva de DigitalOcean.

Ejecutar `Actions → Migrar PostgreSQL a DigitalOcean → Run workflow` y escribir exactamente `MIGRAR`.

El workflow cancela la operación si la base destino no está vacía. Usa herramientas PostgreSQL 17 para evitar incompatibilidades y compara automáticamente los conteos de todas las tablas públicas, incluyendo solicitudes manuales, históricos y homologaciones. El archivo de respaldo se elimina del runner incluso cuando ocurre un error.

## 5. Validar antes de cambiar

1. Abrir `https://DOMINIO-NUEVO/api/health`; debe responder `database: connected`.
2. Comparar los conteos del dashboard con el resumen del workflow.
3. Revisar catálogo, históricos, monitoreo y homologaciones de las seis fuentes.
4. Confirmar que las decisiones de homologación anteriores sigan presentes.

## 6. Cambiar GitHub Actions

Reemplazar el secreto normal `DATABASE_URL` de GitHub por la conexión de DigitalOcean. Eliminar luego los secretos temporales `SOURCE_DATABASE_URL` y `TARGET_DATABASE_URL`.

Reactivar los workflows uno por uno y ejecutar primero un competidor de forma manual. Confirmar que aumenta el histórico exactamente una captura.

## 7. Retiro controlado

Mantener Neon y Vercel durante 48 horas en modo de respaldo. Cuando DigitalOcean complete dos ciclos diarios correctos, descargar un respaldo final y entonces retirar los servicios anteriores.

No aplicar todavía eliminación automática de históricos. `db/retention_preview.sql` calcula cuántos registros afectaría una futura política de 365 días sin modificar datos.
