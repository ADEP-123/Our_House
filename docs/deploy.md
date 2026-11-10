# Despliegue en Vercel + Neon (gratis, sin tarjeta)

Arquitectura de producción:

```
Navegador / PWA ──HTTPS──► Vercel: proyecto "our-house" (Angular, archivos estáticos)
                              └─ /api/* ──proxy──► Vercel: proyecto "our-house-api" (Express como función)
                                                        └──TLS──► Neon (PostgreSQL)
```

- **Dos proyectos de Vercel en el mismo repo:** uno con raíz `frontend/` y otro con raíz `backend/`.
- **Proxy de `/api`:** el frontend reenvía `/api/*` a la API (ver `frontend/vercel.json`). Así el navegador ve un solo dominio y no hace falta CORS.
- **Despliegue automático:** Vercel despliega solo desde GitHub. `main` va a producción y cualquier otra rama genera una *preview* con su propia URL.
- **HTTPS:** viene incluido, así que la PWA se puede instalar sin comprar dominio.

> El plan Hobby de Vercel es gratis y solo para uso personal o no comercial. Si algún día la app se vende como producto, hay que pasar a Pro.

## 1. Base de datos en Neon

1. Entra a https://neon.tech con tu cuenta de GitHub o Google. No pide tarjeta.
2. Crea un proyecto llamado `our-house`, con Postgres en su última versión. Región: **AWS US West 2 (Oregon)**, la más cercana a California.
3. En el dashboard ve a **Connect**, activa **Connection pooling** y copia la cadena de conexión. Debe tener `-pooler` en el host y terminar en `?sslmode=require`. Ese valor es `DATABASE_URL`.

La base se apaga sola cuando no se usa y vuelve a encender en la siguiente consulta. Esa primera consulta tarda un poco más, menos de un segundo.

## 2. API en Vercel (`our-house-api`)

1. Entra a https://vercel.com con GitHub. Usa el plan **Hobby**, que no pide tarjeta.
2. Ve a **Add New… > Project** e importa el repo `Our_House`.
3. En **Project Name** pon `our-house-api`.
4. En **Root Directory** pon `backend`. Vercel detecta Express solo; no hay que cambiar los comandos de build.
5. En **Environment Variables** agrega `DATABASE_URL` con la cadena de Neon, para *Production* y *Preview*.
6. Haz clic en **Deploy**.
7. Abre `https://our-house-api.vercel.app/api/health`. Debe responder `{"status":"ok","db":"up",...}`.

> Si el nombre `our-house-api` ya está tomado, Vercel te asignará otra URL. En ese caso actualiza el `destination` en `frontend/vercel.json` con esa URL y haz commit.

La región de la función está fijada en `pdx1` (Portland), junto a la base de Neon en Oregon. Eso se define en `backend/vercel.json`.

## 3. PWA en Vercel (`our-house`)

1. Ve a **Add New… > Project** e importa otra vez el mismo repo.
2. En **Project Name** pon `our-house`.
3. En **Root Directory** pon `frontend`. Vercel detecta Angular solo.
4. Haz clic en **Deploy**.
5. Abre `https://our-house.vercel.app`. Debe mostrar "Servidor y base de datos conectados". Desde el celular, usa "Agregar a pantalla de inicio" para instalarla.

## 4. Ajustes recomendados (en cada proyecto)

- En **Settings > Git**, revisa que **Production Branch** sea `main`.
- En **Settings > Build and Deployment**, activa **Skip deployments when there are no changes to the root directory or its dependencies**. Así, un cambio solo en `backend/` no reconstruye la PWA, y al revés.

## Cómo queda el flujo

- **Push a `feat/...` o `fase-...`:** GitHub Actions corre las pruebas y los builds (workflow CI), y Vercel crea una URL de preview.
- **Merge de la fase a `main`:** Vercel despliega a producción.

> Las previews del frontend también reenvían `/api` a la API de producción.

## 5. Usuarios, correos y avatares (fase 1)

Haz esto **antes** de mergear la fase 1 a `main`. En producción la API no arranca sin `JWT_SECRET`.

### 5.1 Gmail para enviar correos

1. Crea una cuenta de Gmail solo para la app (por ejemplo, `ourhouse.app@gmail.com`).
2. Activa la **verificación en 2 pasos** en https://myaccount.google.com/security.
3. Entra a https://myaccount.google.com/apppasswords, crea una contraseña de aplicación llamada `Our House` y copia las 16 letras, sin espacios.

### 5.2 Variables del proyecto `our-house-api` en Vercel

Ve a Settings > Environment Variables y agrega estas variables para *Production* y *Preview*:

| Variable | Valor |
|---|---|
| `JWT_SECRET` | Texto aleatorio de 32 caracteres o más. Puedes generarlo con `openssl rand -base64 48` o con cualquier generador de contraseñas largas. |
| `APP_URL` | La URL de la PWA, por ejemplo `https://our-house-fawn.vercel.app` (sin `/` al final). Se usa en los enlaces de los correos. |
| `SMTP_USER` | El Gmail de la app |
| `SMTP_PASS` | La contraseña de aplicación de 16 letras |
| `MAIL_FROM_NAME` | Opcional; por defecto es `Our House` |

### 5.3 Fotos de perfil y de grupo (Vercel Blob)

1. En el proyecto `our-house-api` ve a **Storage > Create Database > Blob**. Ponle el nombre `our-house-avatars` y conéctalo al proyecto.
2. Vercel agrega solo la variable `BLOB_READ_WRITE_TOKEN`.

Mientras no exista el Blob store, la app funciona igual, pero solo con avatares predefinidos o iniciales.

### 5.4 Migraciones de la base de datos

Las tablas se crean con los archivos de `backend/migrations/`, en orden y una sola vez.

- **Automático:** en GitHub ve a Settings > Secrets and variables > Actions y crea el secret `DATABASE_URL` con la cadena de Neon **sin** `-pooler`. Con eso, el workflow **Migraciones** se ejecuta solo cuando llegan migraciones nuevas a `main`, y también se puede lanzar a mano desde Actions.
- **Manual:** desde tu equipo:

```bash
cd backend
DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require" npm run migrate
```

Después de cambiar variables, haz **Redeploy** del proyecto `our-house-api` para que las tome.

## 6. Listas (fase 2)

- **Migraciones:** `005_miembro_supervisado`, `006_listas` y `007_bitacora`. Las aplica el workflow **Migraciones** al llegar a `main` (o a mano con `npm run migrate`, como en 5.4). No hay que crear nada en Neon.
- **Variable opcional** en `our-house-api`: `LIST_ARCHIVE_RETENTION_DAYS`, los días que una lista archivada espera antes de borrarse sola. Si no se define, son 15. El borrado ocurre al abrir las listas del grupo, sin tareas programadas.
- **Sin conexión:** funciona con la PWA publicada (el service worker no corre en `ng serve`). Las listas que se abrieron con conexión quedan guardadas en el dispositivo; los cambios hechos sin red se envían solos al volver. Cerrar sesión borra esa copia.

## 7. Listas avanzadas y recordatorios (fase 3)

- **Migraciones:** de `008_notificaciones` a `013_google_calendar`. Las aplica el workflow **Migraciones** al llegar a `main`.
- **Correos nuevos:** lista nueva del grupo, tarea asignada y recordatorios. Usan el mismo Gmail de la sección 5.1. Gmail permite unos 500 correos al día, de sobra para un grupo familiar. Cada persona los apaga en Perfil > Notificaciones.

### 7.1 Recordatorios cada hora

Vercel gratis solo permite tareas programadas una vez al día, así que el reloj es un workflow de GitHub (gratis en repos públicos) que llama a la API cada hora.

1. Genera una clave larga (por ejemplo con `openssl rand -base64 32`).
2. En Vercel, proyecto `our-house-api` > Settings > Environment Variables: agrega `CRON_SECRET` con esa clave y haz **Redeploy**.
3. En GitHub > Settings > Secrets and variables > Actions:
   - pestaña **Secrets**: `CRON_SECRET` con la misma clave;
   - pestaña **Variables**: `API_URL` = `https://our-house-api.vercel.app`.
4. En Actions > **Recordatorios** > **Run workflow** pruébalo a mano: debe terminar en verde y mostrar `{"sent":0}` (o los que haya enviado).

Notas:
- GitHub puede atrasar unos minutos cada ejecución; la API envía cada recordatorio una sola vez por día y persona.
- En repos públicos, GitHub **pausa los workflows programados tras 60 días sin actividad** en el repo. Si pasa, te avisa por correo; se reactiva con un clic en Actions o con cualquier push.
- El mismo envío repasa Google Calendar: borra eventos de tareas eliminadas y reintenta lo que haya fallado.

## 8. Google Calendar

Opcional. Sin estas variables la app funciona igual y la opción no aparece activa. Se hace una sola vez, unos 15 minutos.

1. Entra a [console.cloud.google.com](https://console.cloud.google.com) con tu cuenta de Google y crea un proyecto llamado **Our House**.
2. **APIs y servicios > Biblioteca**: busca **Google Calendar API** y pulsa **Habilitar**.
3. **Google Auth Platform** (o "Pantalla de consentimiento de OAuth"):
   - **Branding / Información de la app**: nombre `Our House`, tu correo como soporte y como contacto del desarrollador. Sin logo (subir uno obliga a pasar la verificación de Google). Enlaces de la app:
     - página principal: `https://our-house-fawn.vercel.app`
     - política de privacidad: `https://our-house-fawn.vercel.app/privacidad`
     - términos de uso: `https://our-house-fawn.vercel.app/terminos`
     - dominios autorizados: `our-house-fawn.vercel.app`

     Las páginas de privacidad y términos tienen que estar publicadas (la fase 3 en `main`) antes de pulsar **Publicar app**. El correo de contacto que muestran está en `frontend/src/app/features/legal/legal-content.ts`.
   - **Público (Audience)**: tipo **Externo**. Luego pulsa **Publicar app** para pasarla a **En producción**. Importante: en modo "Prueba" Google corta el permiso cada 7 días y habría que reconectar.
   - **Acceso a datos (Data access)**: agrega los permisos `openid`, `.../auth/userinfo.email` y `https://www.googleapis.com/auth/calendar.app.created`. Este último solo deja a la app crear y manejar su propio calendario "Our House", no ve tus otros calendarios.
4. **Clientes (Clients) > Crear cliente**: tipo **Aplicación web**, nombre `Our House`. En **URI de redireccionamiento autorizados** agrega:
   - `https://our-house-fawn.vercel.app/api/google/callback`
   - `http://localhost:4200/api/google/callback` (para desarrollo)
5. Copia el **ID de cliente** y el **Secreto**. En Vercel, proyecto `our-house-api`, agrega `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` y haz **Redeploy**.
6. En la app: Perfil > Google Calendar > **Conectar**. Como la app no pasó la verificación de Google (no hace falta para uso familiar, hasta 100 personas), Google muestra "Google no verificó esta app": toca **Configuración avanzada** > **Ir a Our House** y acepta.

Cómo funciona: cada tarea con fecha aparece en el calendario "Our House" de su responsable (o de quien la creó, si no tiene). Con hora, dura 30 minutos con aviso 30 minutos antes; sin hora, es de todo el día con aviso a las 9 del día anterior. Al completarla su título pasa a "✓ tarea". El refresh token se guarda cifrado con una clave derivada de `JWT_SECRET`: si cambias `JWT_SECRET`, cada persona tiene que volver a conectar.

## 9. Listas secretas y opciones de listas (fase 4)

- **Migraciones:** de `014_opciones_listas` a `016_listas_secretas`. Las aplica el workflow **Migraciones** al llegar a `main`. Las listas existentes conservan sus campos: las de compras quedan con cantidad, categoría y compras, y las de tareas con responsable, fecha y subtareas.
- **Clave de las listas secretas (obligatoria para usarlas):**
  1. Genera una clave: `openssl rand -base64 32` (o cualquier generador de 32 bytes en base64).
  2. En Vercel, proyecto `our-house-api`: agrega `SECRETS_KEY` con ese valor y haz **Redeploy**.
  3. **Guárdala también en un gestor de contraseñas.** Si se pierde o se cambia, la información secreta ya guardada no se puede leer. No la pongas en el repo.

  Sin `SECRETS_KEY`, crear o ver elementos secretos responde "Las listas secretas no están configuradas en el servidor". El resto de la app funciona igual.
- **Cómo se protege:** cada elemento se cifra con AES-256-GCM y una clave propia derivada de `SECRETS_KEY` (HKDF con un valor aleatorio por elemento, ligada a su lista y elemento). Ver los valores pide un código de 6 dígitos al correo (vence en 10 minutos, un uso, 5 intentos). El desbloqueo vive solo en la pantalla abierta y se pierde al salir. Nada de una lista secreta se guarda en el dispositivo.
- **Borrado:** borrar un elemento o una lista secreta la elimina de la base de datos en el acto. Neon puede conservar un historial interno de unas horas para recuperación, siempre cifrado.

## 10. Mejoras diarias (fase 5)

- **Migraciones:** `017_descripcion` (la nota de cada elemento pasa a ser su descripción, hasta 2000 caracteres) y `018_repeticion` (repetición, turnos y la opción **Repetir**, que queda activada en las listas de compras y de tareas que ya existen). Las aplica el workflow **Migraciones** al llegar a `main`. No hay variables nuevas.
- **Tareas que se repiten:** al completarla pasa a su siguiente fecha (fechas fijas o "desde el día en que se hace"), con las subtareas desmarcadas y, si tiene turnos, con la siguiente persona como responsable (le llega el correo de asignación). Las que no tienen fecha, como "Leche cada semana", quedan hechas hasta que les vuelve a tocar: reaparecen al abrir las listas, en Mis tareas y en el envío de cada hora (el mismo workflow de recordatorios).
- **Google Calendar:** el evento de la vez que se completó queda como "✓ tarea" y se crea uno nuevo para la siguiente fecha. "Saltar esta vez" mueve el mismo evento.
- **Ícono de la app:** los archivos de `frontend/public/icons/` y `favicon.ico` salen del dibujo de `frontend/src/app/core/brand/app-icon.ts`, con el color de siempre. La app instalada mantiene ese ícono; el de la pestaña del navegador toma el color principal de la paleta de cada persona. Si el teléfono ya tenía la app instalada, el ícono nuevo aparece cuando el sistema actualiza la app (en Android puede tardar un día; reinstalarla lo cambia al momento).
- **Tareas vencidas:** el título de la pestaña muestra cuántas tareas tuyas están vencidas, por ejemplo "(2) Our House". En la app instalada aparece además como globito sobre el ícono donde el sistema lo permite (Chrome y Edge en escritorio y Android, Safari en iOS 16.4 o más con la app agregada a la pantalla de inicio).

## Desarrollo local

```bash
# PostgreSQL local para desarrollo y pruebas (o usa una rama de Neon)
# API: completa backend/.env (DATABASE_URL, APP_URL=http://localhost:4200) y aplica las migraciones
cd backend && cp .env.example .env && npm install && npm run migrate && npm run dev
# Sin SMTP_USER/SMTP_PASS los correos se muestran en la consola de la API (ahí están los enlaces)
# Pruebas: necesitan un PostgreSQL local; crean y borran la base ourhouse_test
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/ourhouse_test npm test
# PWA (reenvía /api al puerto 3000)
cd frontend && npm install && npm start
```

Sin `DATABASE_URL` la API arranca igual, y `/api/health` responde 503 con `"db":"down"`.
