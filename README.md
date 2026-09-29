# DAKA Price Lab

Aplicación de inteligencia de precios para Tiendas Daka. Captura diariamente el catálogo de DAKA, conserva el histórico en USD y compara productos homologados con Damasco, Multimax, IVOO y Venelectronics.

## Alcance de la Fase 1

- Scraping de Tiendas Daka mediante Playwright.
- Histórico por producto con precio USD y fecha/hora exactas.
- Ejecución local de Daka programada diariamente a las **9:00 AM, hora Venezuela**.
- Ejecución manual desde el panel.
- Alertas por correo electrónico y Telegram.
- Panel comercial de inteligencia de precios.
- Módulo técnico con jobs, duración, páginas, registros y errores.
- Modelo de datos preparado para incorporar competidores en la Fase 2.

## Arquitectura

| Componente | Servicio | Responsabilidad |
|---|---|---|
| Panel y API | Vercel + Next.js | Consulta de precios, históricos, jobs y ejecución manual |
| Base de datos | DigitalOcean Managed PostgreSQL | Productos, capturas, alertas y ejecuciones |
| Scraper Daka | Windows + Python + Playwright | Extracción diaria desde la PC operativa |
| Scrapers competidores | GitHub Actions + Python | Extracción diaria con intentos de respaldo |
| Alertas | SMTP + Telegram Bot API | Notificación de variaciones superiores al umbral |

Los scrapers no se ejecutan dentro de Vercel. Daka se programa en la PC operativa mediante el Programador de tareas de Windows; los competidores usan GitHub Actions. Vercel únicamente consulta PostgreSQL.

## Estructura

```text
app/                         Panel y rutas API de Next.js
components/dashboard.tsx     Interfaz aprobada
db/schema.sql                Modelo PostgreSQL e índices
scraper/scrape.py            Extracción y normalización
scraper/database.py          Persistencia y comparación
scraper/notifications.py     Correo y Telegram
.github/workflows/scrape.yml Ejecución manual de diagnóstico para Daka
```

## 1. Crear la base de datos

1. Crear un clúster PostgreSQL administrado en DigitalOcean.
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
| `DATABASE_URL` | Cadena PostgreSQL de DigitalOcean con `sslmode=require` |
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

Daka no tiene cron en GitHub. Su horario automático se mantiene en el Programador de tareas de Windows a las 9:00 AM VET. GitHub conserva una ejecución manual para diagnóstico.

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

1. Ejecutar la tarea local de Daka desde el Programador de tareas.
2. Confirmar código de resultado `0x0`.
3. Abrir `/api/health` y verificar `{"status":"ok","database":"connected"}`.
4. Revisar el catálogo y el monitoreo técnico en la aplicación.

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
- Consultar el [runbook operativo](docs/operations-runbook.md) para validación diaria, fallos y recuperación.

## Fase 2

La primera integración competitiva incorpora Damasco mediante su catálogo público VTEX:

1. Ejecutar `db/phase2_damasco.sql` una sola vez en PostgreSQL.
2. Publicar `.github/workflows/scrape-damasco.yml` y los nuevos archivos del scraper.
3. Ejecutar manualmente **Scraping diario Damasco** desde GitHub Actions para crear la primera captura.
4. Abrir la pestaña **Competidores** del dashboard.

La homologación automática exige una confianza mínima de 90%. Las coincidencias dudosas quedan en estado `review` y no se presentan como equivalencias hasta ser validadas. Cada fuente conserva su propio producto, job, precio, stock e histórico.

## Fase 4: IVOO

IVOO se integra desde su catálogo público GraphQL. El precio almacenado proviene de
`price.regularPrice.amount.value`, el mismo valor USD que presenta la ficha pública;
no se mezclan cuotas ni modalidades de financiamiento.

1. Publicar los archivos de la integración.
2. Ejecutar **Probar conectividad IVOO**. Consulta solo una página y no escribe en PostgreSQL.
3. Si la prueba termina en verde, ejecutar `db/phase4_ivoo.sql` una sola vez en PostgreSQL.
4. Ejecutar manualmente **Scraping diario IVOO** para crear la primera captura.
5. Verificar IVOO en catálogo, monitoreo, comparador y revisión de homologaciones.
6. Crear en GitHub Actions la variable `IVOO_ENABLED=true` para habilitar los horarios automáticos.

El intento principal se programa a las **9:33 a. m. VET** y los respaldos a las
**11:33 a. m.** y **1:33 p. m.**. Los respaldos se omiten si ya existe una captura
exitosa de IVOO durante ese día en Venezuela.

## Fase 5: Venelectronics

Venelectronics se integra desde la API pública Store de WooCommerce. `prices.price`
es el precio final visible en USD; `prices.regular_price` se conserva como precio lista
solo cuando es mayor. El proceso detecta el desafío anti-bot de SiteGround y cancela
sin guardar productos parciales.

Despliegue controlado:

1. Publicar los archivos de la fase 5.
2. Ejecutar **Probar conectividad Venelectronics**. Consulta una página y no escribe en PostgreSQL.
3. Si la prueba termina en verde, ejecutar `db/phase5_venelectronics.sql` una sola vez en PostgreSQL.
4. Ejecutar manualmente **Scraping diario Venelectronics** para crear la primera captura.
5. Validar catálogo, precios, monitoreo, comparador y candidatos de homologación.
6. Crear la variable de GitHub Actions `VENELECTRONICS_ENABLED=true`.

Los horarios son 9:46 a. m., 11:46 a. m. y 1:46 p. m. VET. Los respaldos se
omiten automáticamente cuando ya existe una captura exitosa del día.
