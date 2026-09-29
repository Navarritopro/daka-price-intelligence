# Runbook operativo

Este documento describe la operación estable mientras la aplicación usa Vercel y
DigitalOcean Managed PostgreSQL. La zona horaria de referencia es Venezuela (VET,
UTC-4).

## Automatizaciones activas

| Proceso | Ejecutor | Horario VET | Recuperación |
|---|---|---:|---|
| Daka | Programador de tareas de Windows | 09:00 | Ejecutar manualmente la tarea local |
| Damasco | GitHub Actions | 09:07 | Respaldos 11:07 y 13:07 |
| Multimax | GitHub Actions | 09:20 | Respaldos 11:20 y 13:20 |
| IVOO | GitHub Actions | 09:33 | Respaldos 11:33 y 13:33 |
| Venelectronics | GitHub Actions | 09:46 | Respaldos 11:46 y 13:46 |
| Homologaciones | GitHub Actions | 10:30 | Ejecución manual de `rematch.yml` |
| Control operativo | GitHub Actions | 14:30 | Alerta si una captura supera 36 horas |
| Respaldo lógico | GitHub Actions | Domingo 04:00 | Artefacto validado, retención de 14 días |

Los respaldos de cada competidor se omiten cuando ya existe una captura exitosa
del mismo día. Daka no tiene horario automático en GitHub para evitar duplicados.

## Comprobación diaria

1. Abrir `https://daka-price-intelligence.vercel.app/api/health` y confirmar
   `{"status":"ok","database":"connected"}`.
2. En el panel de monitoreo verificar que Daka tenga una ejecución exitosa del día.
3. En GitHub Actions confirmar que **Control operativo diario** termine en verde.
4. Durante los primeros tres días registrar el resultado de cada fuente:

| Día | Daka | Damasco | Multimax | IVOO | Venelectronics | Control |
|---|---|---|---|---|---|---|
| 1 | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente |
| 2 | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente |
| 3 | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente |

## Alertas

Los scrapers intentan avisar por Telegram y correo cuando fallan. Las notificaciones
son de mejor esfuerzo: un fallo del canal de alerta no cambia ni oculta el resultado
del scraper.

GitHub Secrets requeridos:

- `DATABASE_URL`
- `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`
- `SMTP_USER` y `SMTP_PASSWORD`

GitHub Variables requeridas para correo:

- `SMTP_HOST`, `SMTP_PORT`, `ALERT_EMAIL_FROM` y `ALERT_EMAIL_TO`

Para que Daka avise desde la PC, configurar esas mismas variables de Telegram/SMTP
en Windows para la cuenta que ejecuta la tarea y reiniciar el Programador de tareas.
Nunca pegar una cadena `DATABASE_URL` en capturas, tickets o logs compartidos.

## Diagnóstico de Daka en Windows

Si la tarea termina con `0x1`, ejecutar el mismo comando en una ventana de CMD para
conservar el error visible. Antes de ejecutar, comprobar qué conexión hereda Python:

```powershell
[Environment]::GetEnvironmentVariable('DATABASE_URL', 'User')
[Environment]::GetEnvironmentVariable('DATABASE_URL', 'Machine')
```

Debe existir una única conexión activa hacia DigitalOcean. Una variable de usuario
antigua puede prevalecer sobre la variable de máquina. Después de rotar credenciales,
actualizar GitHub, Vercel y Windows; luego reiniciar los procesos que las consumen.

## Respaldo y recuperación

El workflow **Respaldo semanal PostgreSQL** genera un `pg_dump` en formato custom,
valida su catálogo con `pg_restore --list`, calcula SHA-256 y conserva el artefacto
14 días. El artefacto contiene información de negocio y solo debe descargarse desde
el repositorio autorizado.

Para restaurar, crear primero una base vacía y usar PostgreSQL 17:

```bash
pg_restore --dbname="$TARGET_DATABASE_URL" --no-owner --no-acl --exit-on-error daka-price-intelligence.dump
```

No restaurar sobre producción sin validar el destino. DigitalOcean también mantiene
sus respaldos administrados; el dump lógico es una segunda vía de recuperación.

## Retención

`db/retention_preview.sql` es solo lectura y calcula el impacto de una futura política
de 365 días. En esta fase no se elimina historial automáticamente. La retención debe
activarse únicamente después de recuperar el histórico de Neon, validar un restore y
aprobar el período comercial necesario.

## Pendientes externos de esta fase

- Completar tres días consecutivos de validación automática.
- Recuperar el histórico de Neon cuando vuelva a estar accesible y ejecutar la
  migración controlada descrita en `docs/digitalocean-migration.md`.
- Sustituir la dependencia de la PC para Daka por un ejecutor siempre disponible,
  una vez demostrada la estabilidad del flujo actual.
