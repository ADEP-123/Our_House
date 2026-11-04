# Our House

Aplicación web y PWA para el día a día de la casa: listas de tareas, calendario, entrenamiento, finanzas y más módulos. Disponible en español e inglés.

## Stack

- **Frontend:** Angular + TypeScript, instalable como PWA
- **Backend:** Node + Express + TypeScript, organizado por capas (routes → controllers → services → repositories)
- **Base de datos:** Oracle Autonomous Database (Always Free)
- **Infraestructura:** Docker Compose + Caddy (HTTPS automático) en una VM Always Free de Oracle Cloud

## Estructura

```
backend/        API Express (src/config, routes, controllers, services, repositories, middlewares)
frontend/       PWA Angular
infra/          Caddyfile y scripts de servidor
docs/           Documentación (despliegue)
.github/        CI y despliegue automático
```

## Desarrollo

```bash
cd backend && cp .env.example .env && npm install && npm run dev   # http://localhost:3000/api/health
cd frontend && npm install && npm start                            # http://localhost:4200
```

## Despliegue

Ver [docs/deploy.md](docs/deploy.md).

## Ramas

- `main`: producción
- `fase-N-nombre`: una fase del proyecto
- `feat/fase-N-descripcion`: una funcionalidad dentro de la fase

Cada feat se mergea a su fase, y la fase se mergea a `main` cuando está completa.
