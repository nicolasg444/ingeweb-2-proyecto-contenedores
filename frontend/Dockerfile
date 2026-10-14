# syntax=docker/dockerfile:1

# ---------- Etapa 1: compilación ----------
# Node solo se necesita para compilar; versión mayor fijada y variante alpine
FROM node:22-alpine AS build
WORKDIR /app
# Primero los manifiestos: `npm ci` queda en caché mientras no cambien las dependencias
COPY package.json package-lock.json ./
# npm ci instala exactamente lo de package-lock.json (reproducible)
RUN npm ci
COPY . .
# Las variables VITE_* quedan incrustadas en el JavaScript público: nunca un secreto
ARG VITE_API_URL=/api
RUN npm run build

# ---------- Etapa 2: servidor estático ----------
# Nginx sin root: corre como usuario nginx (UID 101) y por eso escucha en 8080, no en 80.
# 1.30 = rama estable actual (la 1.27 del enunciado ya no recibe parches: Trivy le halló
# 2 CRITICAL y 39 HIGH)
FROM nginxinc/nginx-unprivileged:1.30-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Solo los archivos compilados: ni Node, ni node_modules, ni el código fuente
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --start-interval=2s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
