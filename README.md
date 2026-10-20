# Mercado Vecino — plataforma contenerizada

Plataforma bogotana que conecta tiendas de barrio con sus clientes para pedidos a domicilio.
Caso de estudio **Contenedores con Docker — Ingeniería Web II**: cuatro contenedores que se
levantan con un solo comando, con imágenes optimizadas y **ninguna contraseña en el código,
en Git, en las imágenes ni en variables de entorno**.

| Servicio | Tecnología | Puerto interno | Red(es) | Función |
|---|---|---|---|---|
| `web` | React + Vite, servido por Nginx sin root | 8080 (único publicado) | frontend | Catálogo y carrito; reenvía `/api/` a la API |
| `api` | Python 3.13 + FastAPI + Uvicorn | 8000 | frontend, backend | REST de tiendas, productos y pedidos |
| `db` | PostgreSQL 17 | 5432 | backend (interna) | Persistencia (volumen `pgdata`) |
| `redis` | Redis 7.4 | 6379 | backend (interna) | Caché del catálogo (volumen `redisdata`) |

## Levantar el proyecto desde un clon limpio

Requisitos: Docker Engine 25+ con Compose v2 (`docker compose version`) o Docker Desktop, y Git.
En Windows, use Git Bash o WSL para el paso 2 (o el script de PowerShell indicado abajo).

```bash
git clone <url-del-repositorio> mercado-vecino && cd mercado-vecino   # 1. clonar
./scripts/generar-secretos.sh                                          # 2. crear .env y contraseñas aleatorias
docker compose -f compose.yaml up -d --build                           # 3. construir y levantar
docker compose ps                                                      # 4. db, redis, api y web en (healthy)
```

Abra **http://localhost:8080**. Tres comandos después del clon.

### Qué trae la página

- **Catálogo con fotos.** Cada tienda y producto tiene su foto; el link está guardado en PostgreSQL
  (columna `imagen_url`) y Nginx sirve el archivo desde `frontend/public/img/`, así funciona sin internet.
- **Cuentas de usuario.** Crear cuenta e ingresar. La contraseña se guarda como hash `scrypt` con sal y
  la sesión es un token JWT firmado con `jwt_secret` (otro secreto de Compose). Cinco intentos fallidos
  bloquean ese correo por 5 minutos (contador en Redis).
- **Canasta y pedidos.** Pedir exige sesión; **Mis pedidos** muestra el historial con las fotos de lo
  comprado. Un usuario no puede ver pedidos de otro aunque cambie el número en la URL.
- **Modo ingeniero** (botón `>_` arriba). Panel en vivo con el diagrama de la arquitectura: cada petición
  ilumina los contenedores por los que pasó, si vino de Redis o de PostgreSQL, cuánto tardó y qué
  contenedor de la API la atendió. Pruebe `docker compose up -d --scale api=3` o `docker compose stop redis`
  con el panel abierto.

- Windows sin Git Bash, paso 2: `powershell -ExecutionPolicy Bypass -File scripts\generar-secretos.ps1`
- `-f compose.yaml` levanta el modo producción (sistema de archivos de solo lectura). Con un simple
  `docker compose up -d --build` Compose fusiona además `compose.override.yaml` (modo desarrollo:
  recarga en caliente montando `./api/app`).

### Comprobar que funciona

```bash
curl -i http://localhost:8080/api/tiendas          # primera vez: X-Cache: MISS (PostgreSQL)
curl -i http://localhost:8080/api/tiendas          # segunda vez: X-Cache: HIT (Redis)
curl http://localhost:8080/api/tiendas/1/productos   # cada producto trae su imagen_url
# Crear cuenta: devuelve un token de sesión
curl -X POST http://localhost:8080/api/auth/registro -H "Content-Type: application/json" \
  -d '{"nombre":"Ana","email":"ana@ejemplo.co","clave":"una-clave-larga"}'
# Pedir con el token (sin él la API responde 401)
curl -X POST http://localhost:8080/api/pedidos -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"tienda_id":1,"cliente":"Ana","direccion":"Cra 7 # 45-10","items":[{"producto_id":1,"cantidad":2}]}'
curl http://localhost:8080/api/sistema               # estado de db y redis visto desde la API
./scripts/auditoria.sh                              # busca credenciales filtradas (debe decir "sin hallazgos")
```

### Apagar

```bash
docker compose down        # borra contenedores y redes; conserva los datos (volúmenes)
docker compose down -v     # borra también los volúmenes: se pierden pedidos y caché
```

## Arquitectura

```
Navegador ──HTTP:8080──▶ web (Nginx) ──red frontend──▶ api (FastAPI) ──red backend (internal)──▶ db (PostgreSQL)
                                                                     └────────────────────────▶ redis
Secretos (archivos en /run/secrets/):  db_password → db   ·   db_app_password → db, api   ·   redis_password → redis, api
                                       jwt_secret → api (firma de las sesiones)
```

- Solo `web` publica un puerto. La red `backend` es `internal: true`: ni `db` ni `redis` tienen
  salida a internet ni puertos publicados, y `web` no puede alcanzarlos.
- Orden de arranque con healthchecks: `db` y `redis` *healthy* → `api` *healthy* → `web`.
- La API usa el rol `mercado_app` (solo `SELECT` en el catálogo y `SELECT, INSERT` en usuarios y
  pedidos), creado por `db/init/02_rol_app.sh`. El superusuario `mercado_admin` solo lo conoce `db`.
- Nginx resuelve `api` con el DNS interno de Docker (`resolver 127.0.0.11`) cada 10 s: reparte entre
  réplicas y no hay que reiniciarlo al escalar. Envía una política CSP que solo permite scripts, fotos
  y peticiones del mismo sitio.
- `GET /tiendas` y `GET /tiendas/{id}/productos` se guardan en Redis `CACHE_TTL_SECONDS` segundos
  (60 por defecto). Si Redis cae, la API responde igual desde PostgreSQL.

## Estructura

```
mercado-vecino/
├── api/
│   ├── app/                 main.py · config.py (lee *_FILE) · db.py · cache.py (Redis) · seguridad.py (scrypt + JWT)
│   ├── tests/               pruebas que corren en la etapa `test` del Dockerfile
│   ├── Dockerfile           multi-etapa: builder → test → runtime (usuario app, UID 10001)
│   ├── .dockerignore
│   ├── requirements.txt     dependencias de ejecución con versión fijada
│   └── requirements-dev.txt dependencias de prueba
├── frontend/
│   ├── src/                 React: App.jsx + componentes/ (canasta, acceso, mis pedidos, modo ingeniero)
│   ├── public/img/          fotos de tiendas y productos + CREDITOS.txt (Wikimedia Commons)
│   ├── Dockerfile           multi-etapa: node:22-alpine → nginx-unprivileged
│   ├── nginx.conf           sirve dist/ y reenvía /api/ → http://api:8000/
│   └── .dockerignore
├── db/init/
│   ├── 01_esquema.sql       tablas y datos semilla
│   └── 02_rol_app.sh        rol de mínimo privilegio para la API
├── scripts/
│   ├── generar-secretos.sh  crea .env y secrets/*.txt (también hay versión .ps1)
│   └── auditoria.sh         auditoría de credenciales del Ejercicio 6
├── docs/
│   ├── INFORME.md           desarrollo de los 6 ejercicios, mediciones, respuestas y reto
│   ├── SOCIALIZACION.md     guion de la presentación de 3 minutos
│   └── evidencia/           salidas de terminal reales
├── compose.yaml             stack de producción
├── compose.override.yaml    ajustes de desarrollo (se fusionan automáticamente)
├── .env.example             configuración sin secretos (sí se versiona)
└── .gitignore               excluye .env y secrets/
```

## Comandos útiles

| Para… | Comando |
|---|---|
| Ver estado y salud | `docker compose ps` |
| Logs de la API | `docker compose logs -f api` |
| Correr las pruebas | `docker build --target test -t mercado-api:test ./api` |
| Consola de PostgreSQL (admin) | `docker compose exec db psql -U mercado_admin -d mercado` |
| Ver la caché | `docker compose exec redis sh -c 'REDISCLI_AUTH=$(cat /run/secrets/redis_password) redis-cli keys "*"'` |
| Tamaño de las imágenes | `docker image ls "mercado-*"` |
| Validar el YAML | `docker compose config` |

## Problemas frecuentes

- **`Defina DB_NAME en .env`**: falta `.env`. Ejecute `./scripts/generar-secretos.sh`.
- **`secret ... file ... not found`**: faltan los archivos de `secrets/`. Mismo script.
- **La API no conecta después de cambiar contraseñas o `db/init/`**: los scripts de inicio solo
  corren con el volumen vacío. En desarrollo: `docker compose down -v` y volver a levantar.
- **`02_rol_app.sh: bad interpreter` o `\r`**: el script se guardó con CRLF. `.gitattributes` fuerza LF;
  si lo editó en Windows, conviértalo con `dos2unix db/init/02_rol_app.sh`.
- **El puerto 8080 está ocupado**: cambie `WEB_PORT` en `.env`.
- **`secret jwt_secret ... not found`** o **`column "imagen_url" does not exist`** en un clon anterior a
  la versión con cuentas: ejecute `./scripts/generar-secretos.sh` (crea solo lo que falta) y recree la base
  con `docker compose down -v` antes de `up`, porque el esquema cambió.
