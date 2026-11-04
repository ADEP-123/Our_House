# Construcción de Angular
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx ng build --configuration production

# Caddy sirve la PWA, hace de proxy a la API y gestiona HTTPS
FROM caddy:2-alpine
COPY --from=build /app/dist/frontend/browser /srv
