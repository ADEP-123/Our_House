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

## Desarrollo local

```bash
# API (necesita DATABASE_URL en backend/.env; puede ser la de Neon o un Postgres local)
cd backend && cp .env.example .env && npm install && npm run dev
# PWA (reenvía /api al puerto 3000)
cd frontend && npm install && npm start
```

Sin `DATABASE_URL` la API arranca igual, y `/api/health` responde 503 con `"db":"down"`.
