# DAKA Price Lab

Aplicación de inteligencia de precios para Tiendas Daka. Captura diariamente el catálogo de `tiendasdaka.com`, conserva el histórico en USD y compara productos homologados con Damasco.

## Alcance de la Fase 1

- Scraping de Tiendas Daka mediante Playwright.
- Histórico por producto con precio USD y fecha/hora exactas.
- Ejecución programada diariamente a las **8:00 AM, hora Venezuela**.
- Ejecución manual desde el panel.
- Alertas por correo electrónico y Telegram.
- Panel comercial de inteligencia de precios.
- Módulo técnico con jobs, duración, páginas, registros y errores.
- Modelo de datos preparado para incorporar competidores en la Fase 2.

## Arquitectura

| Componente | Servicio | Responsabilidad |
|---|---|---|
| Panel y API | Vercel + Next.js | Consulta de precios, históricos, jobs y ejecución manual |
| Base de datos | PostgreSQL / Neon | Productos, capturas, alertas y ejecuciones |
| Scraper | GitHub Actions + Python + Playwright | Extracción diaria o manual |
| Alertas | SMTP + Telegram Bot API | Notificación de variaciones superiores al umbral |

El scraper no se ejecuta dentro de Vercel. GitHub Actions dispone del tiempo y del navegador necesarios para recorrer el catálogo completo. Vercel únicamente consulta PostgreSQL y dispara el workflow manual.

## Estructura

```text
app/                         Panel y rutas API de Next.js
components/dashboard.tsx     Interfaz aprobada
db/schema.sql                Modelo PostgreSQL e índices
scraper/scrape.py            Extracción y normalización
scraper/database.py          Persistencia y comparación
scraper/notifications.py     Correo y Telegram
.github/workflows/scrape.yml Programación diaria y ejecución manual
```

## 1. Crear la base de datos

1. Crear un proyecto PostgreSQL en Neon.
2. Abrir el editor SQL.
3. Ejecutar íntegramente `db/schema.sql`.
4. Copiar la cadena de conexión con SSL.

El esquema registra las fechas como `TIMESTAMPTZ`. La interfaz convierte los valores a `America/Caracas` al mostrarlos.

## 2. Publicar en GitHub

Crear un repositorio y subir este proyecto a la rama `main`:

```bash
git init
git add .
git commit -m "Fase 1 DAKA Price Lab"
git branch -M main
git remote add origin URL_DEL_REPOSITORIO
git push -u origin main
```

### Secrets de GitHub Actions

En **Settings → Secrets and variables → Actions → Secrets**:

| Nombre | Contenido |
|---|---|
| `DATABASE_URL` | Cadena PostgreSQL de Neon |
| `TELEGRAM_BOT_TOKEN` | Token generado por BotFather |
| `TELEGRAM_CHAT_ID` | Chat o grupo que recibirá las alertas |
| `SMTP_USER` | Usuario SMTP |
| `SMTP_PASSWORD` | Contraseña de aplicación SMTP |

### Variables de GitHub Actions

En la sección **Variables**:

| Nombre | Ejemplo |
|---|---|
| `ALERT_THRESHOLD_PERCENT` | `5` |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `465` |
| `ALERT_EMAIL_FROM` | `alertas@empresa.com` |
| `ALERT_EMAIL_TO` | `destino1@empresa.com,destino2@empresa.com` |

El cron está definido como `0 12 * * *`: GitHub Actions utiliza UTC y Venezuela se mantiene en UTC-4, por lo que corresponde a las 8:00 AM VET.

## 3. Preparar la ejecución manual

Crear un token de acceso de GitHub para la cuenta u organización propietaria del repositorio. Conceder únicamente el permiso necesario para ejecutar Actions en este repositorio.

La clave `ADMIN_API_KEY` protege el endpoint manual. El usuario la ingresa al pulsar **Actualizar datos ahora**; no se guarda en el navegador ni forma parte del código.

## 4. Desplegar en Vercel

1. Importar el repositorio de GitHub en Vercel.
2. Mantener el preset **Next.js**.
3. Crear las siguientes variables de entorno de producción:

| Variable | Uso |
|---|---|
| `DATABASE_URL` | Conexión PostgreSQL |
| `ADMIN_API_KEY` | Clave larga para ejecución manual |
| `GITHUB_OWNER` | Usuario u organización propietaria |
| `GITHUB_REPO` | Nombre del repositorio |
| `GITHUB_WORKFLOW_FILE` | `scrape.yml` |
| `GITHUB_TOKEN` | Token con permiso para Actions |

4. Desplegar nuevamente después de crear o modificar variables.

## 5. Primera ejecución

1. Ir a **Actions → Scraping diario Daka**.
2. Seleccionar **Run workflow**.
3. Confirmar que el job termine en verde.
4. Abrir la aplicación en Vercel y verificar el catálogo y el monitoreo técnico.

## Desarrollo local

```bash
cp .env.example .env.local
npm install
npm run dev
```

Para probar el scraper localmente:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r scraper/requirements.txt
playwright install chromium
python scraper/scrape.py
```

## Seguridad

- No subir `.env`, contraseñas ni tokens al repositorio.
- Usar secretos separados en GitHub y Vercel.
- Rotar `ADMIN_API_KEY` y `GITHUB_TOKEN` si se comparten accidentalmente.
- Usar un token de GitHub limitado a un solo repositorio.
- Mantener la base de datos con SSL obligatorio.

## Fase 2

La primera integración competitiva incorpora Damasco mediante su catálogo público VTEX:

1. Ejecutar `db/phase2_damasco.sql` una sola vez en Neon.
2. Publicar `.github/workflows/scrape-damasco.yml` y los nuevos archivos del scraper.
3. Ejecutar manualmente **Scraping diario Damasco** desde GitHub Actions para crear la primera captura.
4. Abrir la pestaña **Competidores** del dashboard.

La homologación automática exige una confianza mínima de 90%. Las coincidencias dudosas quedan en estado `review` y no se presentan como equivalencias hasta ser validadas. Cada fuente conserva su propio producto, job, precio, stock e histórico.
