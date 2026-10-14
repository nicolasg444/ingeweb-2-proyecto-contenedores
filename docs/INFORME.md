# Informe — Caso de estudio: Contenedores con Docker (Ingeniería Web II)

**Proyecto:** Mercado Vecino · **Fecha de ejecución:** 14 de octubre de 2026
**Equipo:** _(completar con los nombres de los integrantes)_

**Entorno real donde se ejecutó todo:** Windows 11 Home · Docker Desktop (Engine 29.8.0, API 1.56) ·
Docker Compose v5.5.1 · Git Bash. Todas las cifras de este informe salen de comandos reales; la salida
completa está en [`docs/evidencia/`](evidencia/).

> En este equipo el puerto 8080 del anfitrión lo ocupa Apache (XAMPP), por eso en las evidencias
> aparece `localhost:8081` (`WEB_PORT=8081` en `.env`). Dentro de Docker todo usa el 8080 del enunciado.

---

## 0. Resumen de resultados

| Indicador | Antes (Ejercicio 1) | Después (stack final) |
|---|---|---|
| Tamaño de la imagen de la API | 1,78 GB | **286 MB** (−84 %) |
| Reconstrucción tras cambiar `main.py` | 20,2 s (reinstala dependencias) | **1,8 s** (`pip install` en caché) |
| Usuario del proceso de la API | `root` | `app` (UID 10001) |
| Contraseñas visibles | en `docker history`, `inspect`, `env` y en un archivo dentro de la imagen | **ninguna** (secretos como archivo) |
| Vulnerabilidades (Trivy) API | 3 695 (16 CRITICAL, 317 HIGH) | **172** (0 CRITICAL) |
| Imagen del frontend | 320 MB (etapa build con Node) | **90 MB** (solo Nginx + `dist/`), 0 HIGH/CRITICAL |
| Servicios | — | 4 (`web`, `api`, `db`, `redis`), todos `healthy` en ~14 s |
| Auditoría de credenciales | — | **sin hallazgos** ([evidencia](evidencia/reto-auditoria.txt)) |

---

## 1. Conceptos y pregunta de activación

**Pregunta:** si borran el contenedor de PostgreSQL, ¿qué pasa con los pedidos guardados?

- **Respuesta antes del Ejercicio 4:** se pierden, porque viven en la capa escribible del contenedor
  y esa capa desaparece al borrarlo.
- **Respuesta después del Ejercicio 4 (corregida y más precisa):** depende de dónde estén los datos.
  - Con un **volumen nombrado** (`pgdata`) **no se pierden**: el volumen sobrevive al contenedor y
    otro contenedor que lo monte ve los mismos datos.
  - **Sin `-v`** se "pierden" para la aplicación, pero no por la razón que creíamos: la imagen
    `postgres` declara `VOLUME /var/lib/postgresql/data`, así que Docker crea un **volumen anónimo**
    por contenedor. `docker rm -f` (sin `-v`) no lo borra: queda huérfano. Lo comprobamos montando
    ese volumen en un contenedor "forense" y la tabla `prueba` seguía ahí
    ([evidencia](evidencia/ej4-volumenes.txt)). El contenedor nuevo recibe otro volumen anónimo vacío,
    así que para la aplicación los datos desaparecieron, y además el huérfano ocupa disco hasta un
    `docker volume prune`.

Relación entre conceptos, en una frase: **la imagen** (capas de solo lectura) es la plantilla; **el
contenedor** le suma una capa escribible efímera; **los volúmenes** son el único lugar donde deben
vivir los datos que importan.

---

## 2. Ejercicio 1 — El Dockerfile ingenuo

Se construyó `api/Dockerfile.ingenuo` tal como lo da el enunciado (`FROM python:latest`,
`COPY . /app`, `ENV DB_PASSWORD=<la del enunciado>`, `CMD` en forma shell). Para respetar la
condición "sin `.dockerignore`" se usó un archivo `Dockerfile.ingenuo.dockerignore` vacío, que
BuildKit prefiere al `.dockerignore` general.

> El archivo no se versiona (`.gitignore`) porque contiene una contraseña a propósito; las
> contraseñas de demostración se reemplazaron por `<REDACTADA>` en las evidencias versionadas.

### Tabla de mediciones (Paso 4)

| Medición | Imagen ingenua | Imagen optimizada (Ej. 2) |
|---|---|---|
| Tamaño (`docker image ls`) | **1,78 GB** (466 MB comprimida) | **286 MB** (66,8 MB comprimida) |
| Tiempo de reconstrucción tras cambiar `main.py` | **20,2 s**: solo `FROM` en caché; `COPY`, `WORKDIR` y `pip install` se repiten | **1,8 s**: todo `CACHED` salvo `COPY app/` |
| Número de capas (`docker history`) | 17 | 18 |
| Usuario del proceso (`whoami`) | `root` | `app` (`uid=10001`) |
| ¿La contraseña aparece en la imagen? | **Sí**: en `docker history`, en `Config.Env` (`docker inspect`), en `env` del contenedor y en `/app/Dockerfile.ingenuo` | **No** (`grep` sin coincidencias) |

Evidencia: [`ej1-mediciones.txt`](evidencia/ej1-mediciones.txt),
[`ej1-rebuild-ingenua.txt`](evidencia/ej1-rebuild-ingenua.txt),
[`ej2-mediciones.txt`](evidencia/ej2-mediciones.txt),
[`ej2-rebuild-optimizada.txt`](evidencia/ej2-rebuild-optimizada.txt).

**Sobre el número de capas:** la imagen optimizada tiene una entrada más en `docker history`, y eso
no es un problema. Las entradas extra (`USER`, `HEALTHCHECK`, `ENV`, `EXPOSE`) son metadatos de
0 B. Lo que importa es cuánto pesa cada capa y la base de la que se parte, no cuántas hay.

### Preguntas de análisis: problemas encontrados

Los ocho de la lista del docente, cada uno **verificado en nuestra imagen**:

1. **`python:latest` no es reproducible.** Lo vivimos en el primer intento: hoy `latest` es
   **Python 3.15.0** y `psycopg-binary==3.2.3` no tiene versión para él, así que la construcción
   **falló**. El mismo Dockerfile que funcionaba hace unos meses hoy no construye.
2. **Base completa con herramientas innecesarias:** `gcc`, `make` y `git` están en la imagen de
   ejecución, y solo la base pesa 1,62 GB.
3. **`COPY . /app` antes de instalar rompe la caché:** cambiar un comentario reinstaló todas las
   dependencias (20 s).
4. **Sin `.dockerignore` entra todo:** `/app` contenía los Dockerfiles, `tests/`, `pytest.ini`, etc.
   Lo más grave: **el propio `Dockerfile.ingenuo`, con la contraseña, quedó copiado dentro de la imagen**.
5. **Caché de pip dentro de la capa:** `/root/.cache/pip` ocupa 25 MB.
6. **`ENV DB_PASSWORD`** visible en `docker history` y en `docker inspect` para cualquiera con la imagen.
7. **Proceso como `root`.**
8. **`CMD` en forma shell:** el PID 1 es `/bin/sh -c uvicorn ...`, no Uvicorn. `sh` no reenvía
   `SIGTERM`, y al hacer `docker stop` el contenedor terminó con **código 137** (matado con `SIGKILL`),
   mientras que la versión optimizada se detuvo limpia en 0,7 s ([evidencia](evidencia/ej1-senales.txt)).

Problemas adicionales que encontramos:

9. **Sin `HEALTHCHECK`:** Docker no sabe si la API responde, solo si el proceso existe.
10. **BuildKit ya advierte dos de los problemas** al construir: `SecretsUsedInArgOrEnv` y
    `JSONArgsRecommended`.

---

## 3. Ejercicio 2 — API optimizada y multi-etapa

Archivos: [`api/Dockerfile`](../api/Dockerfile), [`api/.dockerignore`](../api/.dockerignore).
Etapas: `builder` (crea `/opt/venv` e instala dependencias) → `test` (opcional, corre pytest) →
`runtime` (base `-slim` limpia + `/opt/venv` + `app/`).

### Resultados

- `docker build --target test` → **9 pruebas pasan en 0,49 s** ([evidencia](evidencia/ej2-test.txt)).
- `curl /health` → `{"estado":"ok"}`; `whoami` → `app`; el contenedor queda `healthy`.
- Sin contraseña la API **se niega a arrancar** (`RuntimeError: Falta la configuración DB_PASSWORD`),
  que es lo que pide el diseño de `config.py`.
- El usuario `app` **no puede modificar el código** (`touch /app/app/hack.py` → `Permission denied`),
  porque los archivos son de `root`.
- `docker stop` tarda 0,7 s, porque Uvicorn es el PID 1 y recibe `SIGTERM`.

### Buenas prácticas aplicadas

| Problema del Ej. 1 | Corrección | Cómo se verificó |
|---|---|---|
| `python:latest` | `ARG PYTHON_VERSION=3.13` + `-slim` | `python --version` → 3.13.16 |
| Caché rota | `COPY requirements.txt` antes de `COPY app/` | Reconstrucción de 1,8 s con `pip install` en `CACHED` |
| Archivos sobrantes | `.dockerignore` | `ls /app` → solo `app/` |
| Caché de pip | `--no-cache-dir` | `/root/.cache` inexistente para `app` |
| Herramientas de construcción | Multi-etapa: solo se copia `/opt/venv` | `which gcc make git` → nada |
| Contraseña en `ENV` | Eliminada; se inyecta como secreto (Ej. 6) | `docker history` sin coincidencias |
| Proceso como root | `USER app` con UID/GID 10001 fijos | `id` → `uid=10001(app)` |
| `CMD` en forma shell | Forma exec (JSON) | PID 1 = uvicorn; `docker stop` en 0,7 s |
| _(extra)_ Sin healthcheck | `HEALTHCHECK` con `--start-interval=2s` | Estado `healthy`; Compose lo usa en `depends_on` |

### ¿Qué cambio redujo más el tamaño? (base para la pregunta de reflexión 1)

| Componente | Imagen ingenua | Imagen optimizada |
|---|---|---|
| Imagen base | `python:latest` = **1,62 GB** | `python:3.13-slim` = **176 MB** |
| Dependencias de Python | 83 MB | 82 MB (`/opt/venv`) |
| Caché de pip | 25 MB | 0 |

Cambiar a la base **`-slim`** explica unos 1,45 GB de los 1,5 GB ahorrados. En este proyecto la
multi-etapa ahorra poco espacio, porque `psycopg[binary]` trae sus binarios compilados y no hace
falta compilador. Su beneficio aquí es **separar las pruebas y dejar fuera lo que no se usa**. Como
dice la nota del enunciado, la multi-etapa ahorraría mucho más si se compilara `psycopg` con
`build-essential` y `libpq-dev`: esas herramientas quedarían solo en `builder`, y en `runtime`
bastaría con `libpq5`.

### Verificación: ¿por qué `DB_PASSWORD=solo-pruebas` no llega a la imagen final?

Por tres razones, todas comprobadas ([evidencia](evidencia/ej2-verificacion.txt)):

1. La etapa `runtime` empieza con un `FROM python:3.13-slim` **nuevo**. De las etapas anteriores
   solo pasa lo que se copia explícitamente con `COPY --from=builder /opt/venv`.
2. Al construir la imagen final, **BuildKit ni siquiera ejecuta la etapa `test`**, porque `runtime`
   no depende de ella. En el log aparecen solo los pasos `[builder]` y `[runtime]`.
3. La variable se definió **dentro del `RUN`**, no con `ENV`, así que no persiste ni en la etapa
   `test`. Ojo: sí aparece como texto del comando en `docker history mercado-api:test`. Por eso es un
   valor de mentira y esa imagen nunca se publica.

`docker history --no-trunc mercado-api:1.0 | grep -c solo-pruebas` → **0**.

### Hallazgo propio: redis-py y los reintentos

Al agregar la prueba "Redis caído no rompe la API", la suite tardaba **8,4 s**. redis-py 8
**reintenta con espera por defecto**, así que con Redis caído **cada petición** habría esperado ~8 s.
Se configuró `retry=Retry(NoBackoff(), 0)` y la prueba ahora exige que la respuesta tarde menos de
2 s. También se cambió `httpx` por `httpx2`, porque Starlette marcaba como obsoleto el uso de `httpx`
en su cliente de pruebas.

---

## 4. Ejercicio 3 — Frontend multi-etapa con Nginx

Archivos: [`frontend/Dockerfile`](../frontend/Dockerfile), [`frontend/nginx.conf`](../frontend/nginx.conf),
[`frontend/.dockerignore`](../frontend/.dockerignore). La aplicación React muestra las tiendas,
sus productos, un carrito y el formulario de pedido, con una etiqueta que indica si el catálogo
vino de Redis o de PostgreSQL ([captura](evidencia/captura-frontend.png)).

| Imagen | Tamaño | Contenido |
|---|---|---|
| `mercado-web:build` (etapa `build`) | **320 MB** | Node 22, 40,6 MB de `node_modules`, código fuente |
| `mercado-web:1.0` con `nginx-unprivileged:1.27-alpine` (enunciado) | **73,9 MB** | Nginx + `index.html` + 2 archivos de `assets/` |
| `mercado-web:1.0` final con `1.30-alpine` (ver sección 8) | **90,3 MB** | Igual, sobre una base sin vulnerabilidades altas |

La imagen final **no tiene `node` ni `npm`**, corre como `nginx` (UID 101) y escucha en 8080
([evidencia](evidencia/ej3-mediciones.txt)).

Lo que agregamos al `nginx.conf` del enunciado:
- `location = /healthz` para el `HEALTHCHECK` del contenedor, que no depende de la API.
- Encabezados `X-Content-Type-Options`, `X-Frame-Options` y `Referrer-Policy`. `server_tokens off`
  hace que el encabezado `Server` no revele la versión.
- `expires 1y` para `/assets/`: Vite pone un hash en los nombres de archivo, así que se pueden
  cachear sin riesgo. Se usó `expires` y no `add_header` porque un `add_header` dentro de un
  `location` anula los del bloque `server`.

### Decisiones de diseño

- **`npm ci` en lugar de `npm install`:** instala exactamente lo de `package-lock.json` y falla si
  no coincide con `package.json`. Así la construcción es reproducible. Que `COPY package*.json` vaya
  antes de `COPY . .` deja `npm ci` en caché mientras no cambien las dependencias.
- **`nginx-unprivileged` y el puerto 8080:** el proceso no es root, y los puertos menores a 1024
  requieren privilegios (`CAP_NET_BIND_SERVICE`). Por eso escucha en 8080.
- **El reenvío `/api/`** evita configurar CORS (para el navegador todo tiene el mismo origen) y la
  API no se publica: el navegador solo habla con Nginx.

### Pregunta de seguridad: `ARG VITE_PAYMENTS_KEY=sk_live_...`

Sería una fuga grave. Vite **reemplaza `import.meta.env.VITE_*` por el valor literal** al compilar,
así que la clave quedaría escrita en `assets/index-*.js`, que descarga **cualquier visitante** (basta
con abrir las herramientas de desarrollo del navegador). Además quedaría en los metadatos de
construcción por ser `ARG`. Con una clave `sk_live` cualquiera podría cobrar o reembolsar a nombre
de la empresa. Las claves privadas viven **solo en el backend**: el frontend llama a la API y la
API habla con la pasarela de pagos. En el frontend solo pueden ir claves **publicables** (`pk_...`).

---

## 5. Ejercicio 4 — Volúmenes y persistencia de PostgreSQL

Evidencia completa: [`ej4-volumenes.txt`](evidencia/ej4-volumenes.txt).

| Paso | Resultado |
|---|---|
| 1. Contraseña en archivo | `secrets/db_password.txt` generado con `openssl rand -hex 24` y ignorado por Git |
| 2. Sin volumen | Después de `docker rm -f` y de crear el contenedor otra vez: `ERROR: relation "prueba" does not exist` |
| 3. Con volumen `pgdata` | Después de borrar y recrear el contenedor, `SELECT * FROM prueba` → `1`. El log dice `Skipping initialization` |
| 4. Bind mount `db/init:ro` | Corren `01_esquema.sql` y `02_rol_app.sh`: 5 tiendas, 18 productos y el rol `mercado_app` |

**Hallazgo en Windows:** `openssl` de Git Bash escribe `\r\n` al final. PostgreSQL quita el `\n`
pero **no el `\r`**, así que la contraseña real habría incluido un carácter invisible, mientras que
la API (que hace `.strip()`) habría usado otra. Por eso `scripts/generar-secretos.sh` quita
`\r\n` (`tr -d '\r\n'`) y los archivos miden exactamente 48 bytes.

### Comparación de tipos de montaje

| Tipo | Sintaxis | Quién lo gestiona | Uso en Mercado Vecino |
|---|---|---|---|
| Volumen nombrado | `pgdata:/var/lib/postgresql/data` | Docker | Datos de PostgreSQL (y `redisdata` para Redis) en todos los entornos |
| Bind mount de solo lectura | `./db/init:/docker-entrypoint-initdb.d:ro` | El desarrollador | Esquema, datos semilla y rol de la aplicación |
| Bind mount de lectura y escritura | `./api/app:/app/app` | El desarrollador | Recarga en caliente, solo en desarrollo (`compose.override.yaml`) |
| Volumen anónimo _(lo descubrimos)_ | `VOLUME` en la imagen, sin `-v` | Docker, sin nombre | Nunca: queda huérfano y nadie lo encuentra |
| Sin montaje (capa del contenedor) | — | Nadie | Nunca para datos que importen |
| tmpfs | `tmpfs: [/tmp]` | Memoria | Archivos temporales de `api`, `redis` y `web`, cuyo disco es de solo lectura |

### Preguntas de cierre

1. **¿Su respuesta de activación era correcta?** A medias: los datos sí "se pierden" sin volumen
   nombrado, pero no por la capa del contenedor, sino por el volumen anónimo que queda huérfano
   (ver sección 1).
2. **¿Un cambio en `01_esquema.sql` se aplica al reiniciar con el volumen existente?** **No.**
   Agregamos `CREATE TABLE nueva(x int);`, reiniciamos y `\dt` siguió mostrando 4 tablas; el log
   dice `Database directory appears to contain a database; Skipping initialization`. Los scripts de
   `/docker-entrypoint-initdb.d` solo corren con el directorio de datos vacío. En producción los
   cambios de esquema se hacen con **migraciones** versionadas (Alembic, Flyway, etc.).
3. **¿Qué comando borra los datos de forma definitiva?** `docker volume rm pgdata`, o en Compose
   `docker compose down -v`. También `docker volume prune` para los volúmenes sin uso.

---

## 6. Ejercicio 5 — Docker Compose del stack completo

La versión del enunciado (contraseña en variable de entorno) se conserva como registro en
[`docs/ejercicios/compose.ej5.yaml`](ejercicios/compose.ej5.yaml). La versión final es el
[`compose.yaml`](../compose.yaml) de la raíz.

### Resultados ([evidencia](evidencia/ej5-compose.txt))

- **Sin `DB_PASSWORD`, Compose se niega a arrancar:**
  `required variable DB_PASSWORD is missing a value: Defina DB_PASSWORD en .env`.
- **`up -d --build`** en 15 s, en orden: `db` healthy → `api` healthy → `web` healthy.
- **`curl /api/tiendas`** devuelve las 5 tiendas a través de Nginx.
- **Aislamiento:**
  - `api` resuelve `db` (172.20.0.2).
  - `web` → `wget: bad address 'db:5432'`: web **no alcanza** db.
  - `db` → `wget: bad address 'pypi.org'`: la red `backend` (`internal=true`) **no tiene salida a internet**.
  - `db` y `api` sin puertos publicados; solo `web` publica uno.
- **Endurecimiento:** `ReadOnly=true CapDrop=[ALL] SecOpt=[no-new-privileges:true]`; `touch /app/prueba`
  → `Read-only file system`.

### Qué hace cada decisión

| Elemento | Efecto |
|---|---|
| `${DB_PASSWORD:?mensaje}` | Compose se niega a arrancar si falta la variable, en lugar de usar un valor vacío (comprobado) |
| `depends_on` + `condition: service_healthy` | La API espera a que PostgreSQL acepte conexiones, no solo a que el contenedor exista |
| `$${POSTGRES_USER}` | El doble `$` evita que Compose interpole; la variable se resuelve dentro del contenedor |
| Red `backend` con `internal: true` | La base de datos no tiene salida a internet ni puertos publicados (comprobado con `wget`) |
| Solo `web` publica un puerto | Toda petición externa entra por Nginx |
| `read_only`, `tmpfs`, `cap_drop`, `no-new-privileges` | La API no puede escribir en su sistema de archivos ni escalar privilegios |
| _(nuestro)_ `start_interval: 2s` en los healthchecks | Durante el arranque se revisa cada 2 s, no cada 10–30 s. El stack completo queda listo en ~14 s |

### Paso 5 — desarrollo con `compose.override.yaml` ([evidencia](evidencia/ej5-desarrollo.txt))

Con `docker compose up -d`, Compose fusionó el override: `--reload`, bind mount de `./api/app` y
`ReadOnly=false`. Agregamos un endpoint `/version` en el anfitrión **sin reconstruir la imagen**, y
Uvicorn mostró `WatchFiles detected changes in 'app/main.py'. Reloading...`; `curl /api/version`
respondió `{"version":"dev"}`. Con `docker compose -f compose.yaml up -d` se volvió a la imagen
inmutable (`ReadOnly=true`, sin `--reload`).

### Paso 6 — ciclo de vida ([evidencia](evidencia/ej5-ciclo-de-vida.txt))

Se creó el pedido #1 (6 panes aliñados + 4 pandebonos = $16.200). Después de `down` el volumen
`mercado-vecino_pgdata` siguió en `docker volume ls`, y tras `up` el pedido #1 seguía ahí. Con
`down -v` el volumen desapareció.

---

## 7. Ejercicio 6 — Manejo seguro de credenciales

### Paso 1 — descubrir la fuga ([evidencia](evidencia/ej6-paso1-fuga.txt))

Con el stack del Ejercicio 5 (clave de prueba desechable), **los tres comandos mostraron la
contraseña en texto plano**: `docker inspect ... .Config.Env`, `docker compose config` y
`/proc/1/environ` dentro de la API. También `docker inspect` del contenedor `db`
(`POSTGRES_PASSWORD=...`).

### Pasos 2 y 3 — migración a secretos y verificación ([evidencia](evidencia/ej6-reto-verificacion.txt))

`compose.yaml` declara tres secretos (archivos en `secrets/`, ignorados por Git) y cada servicio
recibe **solo los que necesita**:

| Secreto | `db` | `api` | `redis` | Para qué |
|---|---|---|---|---|
| `db_password` | ✔ | — | — | Superusuario `mercado_admin` (solo administración) |
| `db_app_password` | ✔ | ✔ | — | Rol `mercado_app` de la API (lo crea `02_rol_app.sh`) |
| `redis_password` | — | ✔ | ✔ | `requirepass` de Redis |

Verificación después de `down -v` y `up -d --build`:
- `docker inspect ... .Config.Env` de `api` y `db` → solo rutas (`DB_PASSWORD_FILE=/run/secrets/...`).
- `/proc/1/environ` de la API → solo las variables `*_FILE`.
- `docker compose config | grep -i password` → solo rutas y nombres de archivo.
- `ls /run/secrets/` en `api` → `db_app_password` y `redis_password`. **La API no recibe la
  contraseña del superusuario.**
- `curl /api/tiendas` → funciona. La API no necesitó cambios: `leer_secreto()` ya buscaba `*_FILE`.

### Paso 4 — secretos en tiempo de construcción ([evidencia](evidencia/ej6-paso4-secreto-build.txt))

Se hizo una demostración reproducible con
[`docs/ejercicios/Dockerfile.secreto-build`](ejercicios/Dockerfile.secreto-build):
- Con `RUN --mount=type=secret,id=pip_token`, el token está disponible **solo durante ese `RUN`**
  (25 bytes); en el `RUN` siguiente ya no existe.
- `docker history --no-trunc` y `docker image inspect` → **0** apariciones del valor del token.
- Con `required=true`, construir sin `--secret` falla: `secret pip_token: not found`.

En Compose el mismo secreto se declara en `build.secrets` del servicio. Nuestra API no lo necesita
porque instala solo desde PyPI público.

### Tabla de antipatrones (para la plenaria)

| Práctica | ¿Dónde queda expuesta la credencial? | Alternativa | ¿Lo vimos? |
|---|---|---|---|
| `ENV DB_PASSWORD=...` en el Dockerfile | En la imagen, para siempre: `docker history`, registros de imágenes | Inyectar al ejecutar | Sí, Ej. 1 |
| `ARG TOKEN=...` en el Dockerfile | En los metadatos de construcción | `RUN --mount=type=secret` | Demo Paso 4 |
| `COPY .env` o `COPY . .` sin `.dockerignore` | Dentro de la imagen | `.dockerignore` con `.env` | Sí: el Dockerfile con la clave quedó en `/app` |
| Contraseña escrita en `compose.yaml` | En Git y en cada copia del repositorio | Archivo de secreto ignorado por Git | Evitado |
| `-e DB_PASSWORD=...` en la terminal | En el historial del shell y en `docker inspect` | `secrets` o `--env-file` | — |
| Variable de entorno desde `.env` | En `docker inspect` y `/proc/1/environ` | Secretos montados como archivo | Sí, Ej. 6 Paso 1 |
| `VITE_*` o `REACT_APP_*` con claves | En el JavaScript público | La clave vive solo en el backend | Pregunta del Ej. 3 |
| Secretos de Compose en desarrollo | Archivo en disco del desarrollador | En producción: gestor de secretos del orquestador o de la nube | Limitación aceptada |
| _(nuestra)_ `redis-server --requirepass $(cat ...)` | En los argumentos del proceso (`/proc/1/cmdline`, `ps`) | Archivo de configuración en tmpfs | Evitado: `cmdline` = `redis-server *:6379` |
| _(nuestra)_ `redis-cli -a clave` en el healthcheck | En `docker inspect` (`Healthcheck.Test`) y en `ps` | `REDISCLI_AUTH` leído del secreto | Evitado |

### Paso 5 — auditoría cruzada

[`scripts/auditoria.sh`](../scripts/auditoria.sh) ejecuta los tres comandos del enunciado y además
una prueba más fuerte: busca **el valor real** de cada secreto en todo el historial de Git, en
`docker history` e `image inspect` de ambas imágenes, en sus sistemas de archivos y en `Env`/`Cmd`
de los cuatro contenedores. Resultado: **sin hallazgos**
([evidencia](evidencia/reto-auditoria.txt)).

Los comandos del enunciado encuentran palabras como `password` o `secret`, y eso es esperable: son
**nombres** de variables y rutas (`DB_PASSWORD_FILE`, `/run/secrets/db_password`), no valores. Por
eso la segunda parte busca valores.

Lección del enunciado que aplicamos: si una contraseña llega a Git, borrarla en un commit nuevo no
basta, porque sigue en el historial; la única respuesta correcta es **cambiarla**. Por eso el
`Dockerfile.ingenuo` (con contraseña) nunca entró al repositorio, y las contraseñas de demostración
se redactaron en las evidencias antes del primer commit.

---

## 8. Ampliación opcional — escaneo con Trivy ([evidencia](evidencia/ampliacion-trivy.txt))

Trivy 0.76.0, escáneres `vuln` y `secret`:

| Imagen | CRITICAL | HIGH | MEDIUM | LOW | Total |
|---|---|---|---|---|---|
| `mercado-api:ingenua` (`python:latest`) | 16 | 317 | 1 581 | 1 632 | **3 695** |
| `mercado-api:1.0` (`python:3.13-slim`) | 0 | 48 | 60 | 61 | **172** |
| `mercado-web:1.0` con `nginx-unprivileged:1.27-alpine` | 2 | 39 | 76 | 42 | **159** |
| `mercado-web:1.0` con `nginx-unprivileged:1.30-alpine` | 0 | 0 | 1 | 0 | **1** |

Discusión:
- **Menos paquetes, menos superficie de ataque:** pasar a `-slim` eliminó el 95 % de las
  vulnerabilidades de la API sin tocar el código.
- **Fijar versión no basta: hay que mantenerla.** La `1.27-alpine` del enunciado es una rama de Nginx
  que ya no recibe parches (Alpine 3.21.3). Trivy le encontró 2 CRITICAL de OpenSSL. Se cambió a la
  rama estable actual `1.30-alpine` (Alpine 3.24.2), que queda con 1 MEDIUM y pesa 16 MB más, un
  intercambio que vale la pena.
- **El escáner de secretos de Trivy no detectó `DB_PASSWORD=<valor>`** en la imagen ingenua: sus
  reglas buscan formatos conocidos (claves de AWS, GitHub, Stripe, etc.), no contraseñas arbitrarias.
  Un escáner complementa la revisión manual y la búsqueda de valores (`auditoria.sh`), no la reemplaza.

---

## 9. Reto integrador — Redis como caché del catálogo

| Requisito | Cómo se cumple | Evidencia |
|---|---|---|
| ☑ Redis en `backend`, sin puertos publicados, contraseña como secreto | `networks: [backend]`, sin `ports`; `requirepass` sale de `/run/secrets/redis_password` y se escribe en `/tmp/redis.conf` (tmpfs, `umask 077`). `redis-cli ping` sin clave → `NOAUTH` | `ej6-reto-verificacion.txt` |
| ☑ Volumen nombrado propio + healthcheck `redis-cli ping` | Volumen `redisdata` con `--appendonly yes`. Healthcheck `REDISCLI_AUTH=... redis-cli ping \| grep -q PONG`. Tras reiniciar Redis la caché seguía (`HIT`) | `ej6-reto-verificacion.txt`, `reto-redis-caido.txt` |
| ☑ La API espera a Redis con `service_healthy` | `depends_on: {db: service_healthy, redis: service_healthy}` | `docker compose config api` |
| ☑ Rol de PostgreSQL de mínimo privilegio en `db/init/` | `02_rol_app.sh` crea `mercado_app`: `SELECT` en `tiendas`/`productos`; `SELECT, INSERT` en `pedidos`/`pedido_items`; sin `CREATE` en el esquema. La contraseña se lee del secreto con el comando `\set` de psql (que ejecuta `cat`), sin pasar por variables ni argumentos | Pruebas: `UPDATE`, `DELETE`, `DROP`, `CREATE TABLE`, `CREATE ROLE` y `pg_shadow` → **permission denied** |
| ☑ README con pasos desde un clon limpio en menos de 5 comandos | 3 comandos tras el clon (`generar-secretos.sh`, `up -d --build`, `ps`). Probado en un clon nuevo | [`README.md`](../README.md), `reto-clon-limpio.txt` |
| ☑ Evidencia de `docker compose ps`, tamaño de imágenes y auditoría sin hallazgos | Ver abajo | `reto-evidencia-final.txt`, `reto-auditoria.txt` |

### Comportamiento de la caché

- `GET /tiendas` y `GET /tiendas/{id}/productos` se guardan en Redis 60 s (`CACHE_TTL_SECONDS`). La
  respuesta incluye `X-Cache: MISS` (PostgreSQL) o `X-Cache: HIT` (Redis), y el frontend lo muestra.
- Medido con `curl` (5 muestras): **MISS ≈ 13 ms, HIT ≈ 4,5 ms**.
- `POST /pedidos` usa el rol `mercado_app`. El precio sale de la base de datos, nunca del cliente,
  y se rechazan productos de otra tienda (`422`).

### Resiliencia: Redis caído ([evidencia](evidencia/reto-redis-caido.txt))

La caché es una optimización: si Redis cae, la API debe seguir respondiendo. Al probarlo
encontramos que **cada petición tardaba 12 s**. Con el contenedor detenido, el nombre `redis` deja
de existir y la búsqueda DNS en la red interna tardaba 8 s (el `connect_timeout` no cubre el DNS).
Se corrigió en dos capas:

1. **Cortacircuitos** en `cache.py`: después de un fallo, la API omite Redis durante 30 s.
2. **`dns_opt: ["timeout:1", "attempts:1"]`** en la API: el primer fallo tarda ~1 s, no 8.

Resultado con Redis detenido: la 1.ª petición 1,0 s, las siguientes **13 ms**, todas `HTTP 200`.
Al volver Redis, la caché se recupera sola.

---

## 10. Hallazgos propios (más allá de la guía)

| # | Hallazgo | Corrección |
|---|---|---|
| 1 | `python:latest` ya es 3.15 y rompió `psycopg-binary==3.2.3` | Versiones de dependencias actualizadas y fijadas; base fijada en 3.13 |
| 2 | Sin `.dockerignore`, el propio Dockerfile con la contraseña quedó dentro de la imagen | `.dockerignore` con `Dockerfile*` y `.env*` |
| 3 | `openssl` en Windows escribe `\r\n`; PostgreSQL conserva el `\r` en la contraseña | `tr -d '\r\n'` en el generador y `.gitattributes` con `eol=lf` |
| 4 | Volúmenes anónimos huérfanos con datos "perdidos" | Siempre volúmenes nombrados |
| 5 | redis-py 8 reintenta por defecto: ~8 s por petición con Redis caído | `Retry(NoBackoff(), 0)` + prueba con límite de tiempo |
| 6 | DNS de 8 s con un servicio detenido en la red interna | Cortacircuitos + `dns_opt` |
| 7 | `nginx-unprivileged:1.27` sin parches (2 CRITICAL) | `1.30-alpine` (rama estable) |
| 8 | `redis-cli -a` y `--requirepass` exponen la clave en `ps` e `inspect` | `REDISCLI_AUTH` y configuración en tmpfs |
| 9 | Healthchecks de 30 s retrasaban el arranque | `start_interval: 2s` (stack listo en ~14 s) |
| 10 | `git check-ignore -q` solo admite una ruta: la verificación del script fallaba | Dos llamadas separadas |

---

## 11. Preguntas de reflexión (individuales)

> Son una base del equipo con datos medidos; cada integrante debe redactar la suya.

**1. ¿Qué cambio del Ejercicio 2 produjo la mayor reducción de tamaño y por qué?**
Cambiar `python:latest` por `python:3.13-slim`: la base pasó de 1,62 GB a 176 MB y explica
~1,45 GB de los 1,5 GB ahorrados. La imagen completa trae compiladores, cabeceras, `git`, ImageMagick,
librerías de bases de datos, etc., pensados para compilar cualquier cosa, y la API no los necesita en
ejecución. `--no-cache-dir` ahorró 25 MB. La multi-etapa ahorró poco aquí porque `psycopg[binary]`
ya viene compilado; ahorraría mucho más si hubiera que compilar dependencias en C.

**2. «Mi `.env` está en `.gitignore`, así que mis credenciales están seguras». ¿De acuerdo?**
No. `.gitignore` solo evita que el archivo **entre a Git**, y eso es una parte del problema:
- El valor termina en **variables de entorno** del contenedor, visibles con `docker inspect`, en
  `/proc/1/environ` y en `docker compose config` (lo demostramos en el Ejercicio 6, Paso 1). Además
  las variables se heredan a procesos hijos y suelen aparecer en volcados de error.
- Sin `.dockerignore`, un `COPY . .` mete el `.env` **dentro de la imagen**.
- Si el `.env` se versionó **antes** de agregarlo a `.gitignore`, sigue en el historial.
- No protege la copia en disco del desarrollador ni los respaldos.

Lo correcto es secretos como archivo en `/run/secrets` (Compose), con permisos por servicio. En
producción, un gestor de secretos.

**3. ¿En qué casos usarían un bind mount en producción y en cuáles nunca?**
- **Sí (con `:ro` siempre que se pueda):** archivos de configuración gestionados por el despliegue
  (un `nginx.conf`, certificados TLS que renueva el anfitrión), scripts de inicialización, y
  directorios de logs que recoge un agente del anfitrión.
- **Nunca:** el código fuente (en producción el código va **dentro de la imagen**, inmutable y
  versionada; la recarga en caliente es solo para desarrollo), el `docker.sock` en un contenedor de
  aplicación (equivale a dar root en el anfitrión), carpetas del sistema del anfitrión (`/`, `/etc`)
  en lectura y escritura, y los datos de la base de datos cuando un volumen nombrado sirve (los
  volúmenes los gestiona Docker y no dependen de rutas ni permisos del anfitrión).

**4. Si Mercado Vecino pasa a Kubernetes, ¿qué partes del `compose.yaml` tienen equivalente directo y cuáles no?**

| `compose.yaml` | Kubernetes | ¿Directo? |
|---|---|---|
| `services` (`api`, `web`) | `Deployment` + `Service` (DNS por nombre) | Sí |
| `db`, `redis` con datos | `StatefulSet` + `PersistentVolumeClaim` (o servicio gestionado) | Sí |
| `volumes` nombrados | `PersistentVolumeClaim` | Sí |
| `secrets` | `Secret` montado como archivo (en etcd solo en base64: hay que activar cifrado o usar un gestor externo) | Sí, con matices |
| `environment` / `.env` | `ConfigMap` + `env` | Sí |
| `healthcheck` | `livenessProbe`, `readinessProbe`, `startupProbe` (más expresivo) | Sí |
| `user`, `read_only`, `cap_drop`, `no-new-privileges` | `securityContext` (`runAsNonRoot`, `readOnlyRootFilesystem`, `capabilities.drop`, `allowPrivilegeEscalation: false`) | Sí |
| `tmpfs` | `emptyDir` con `medium: Memory` | Sí |
| `restart: unless-stopped` | `restartPolicy` (los Deployments siempre reinician) | Sí |
| `ports` de `web` | `Service` tipo `LoadBalancer`/`NodePort` o `Ingress` | Sí |
| `dns_opt` | `dnsConfig` del Pod | Sí |
| `networks` + `internal: true` | **No hay redes por servicio**: la red es plana. Se aproxima con `NetworkPolicy` (requiere un CNI que las aplique) | No |
| `depends_on` + `service_healthy` | **No existe**: se usan `readinessProbe`, `initContainers` y reintentos en la aplicación | No |
| `build` | **No existe**: la imagen se construye en CI y se publica en un registro | No |
| `compose.override.yaml` | Overlays de Kustomize o valores de Helm | Parcial |
| Interpolación `${VAR:?}` | Helm/Kustomize | Parcial |

---

## 12. Autoevaluación con la rúbrica

| Criterio | Peso | Nivel | Justificación |
|---|---|---|---|
| Dockerfiles optimizados | 25 | Excelente | Multi-etapa, versión fijada, caché ordenada (1,8 s), `.dockerignore`, usuario no root, healthcheck, forma exec |
| Docker Compose | 25 | Excelente | Redes `frontend`/`backend` (interna), healthchecks en los 4 servicios, `depends_on` con condición, volúmenes `pgdata` y `redisdata` |
| Manejo de credenciales | 30 | Excelente | Cero credenciales en Git, imágenes o variables (auditoría por valor); secretos como archivo, por servicio; rol de mínimo privilegio |
| Reproducibilidad y documentación | 10 | Excelente | README probado en un clon limpio |
| Socialización | 10 | — | Guion en [`SOCIALIZACION.md`](SOCIALIZACION.md) |

---

## Anexo — Índice de evidencias

| Archivo | Contenido |
|---|---|
| `ej1-build-ingenua.txt`, `ej1-rebuild-ingenua.txt` | Construcción y reconstrucción de la imagen ingenua |
| `ej1-mediciones.txt` | Tamaño, capas, contraseña, `whoami`, contenido de `/app`, caché de pip, compiladores |
| `ej1-senales.txt` | PID 1 = `sh`, `docker stop` termina con 137 |
| `ej2-build-optimizada.txt`, `ej2-rebuild-optimizada.txt` | Construcción multi-etapa y reconstrucción en caché |
| `ej2-test.txt` | Etapa `test`: 9 pruebas |
| `ej2-mediciones.txt` | Tamaño, usuario, código de solo lectura, `/health`, apagado limpio |
| `ej2-verificacion.txt` | `solo-pruebas` no llega a la imagen final |
| `ej3-*.txt`, `captura-frontend.png` | Frontend: etapas, tamaños, contenido |
| `ej4-volumenes.txt` | Sin volumen, con volumen, volumen anónimo huérfano, init scripts, pregunta de cierre 2 |
| `ej5-compose.txt`, `ej5-ciclo-de-vida.txt`, `ej5-desarrollo.txt` | Stack con variables, aislamiento, ciclo de vida, override |
| `ej6-paso1-fuga.txt` | Contraseña visible por variables de entorno |
| `ej6-stack-final.txt`, `ej6-reto-verificacion.txt` | Stack final con secretos, Redis, caché y rol |
| `ej6-paso4-secreto-build.txt` | Secreto de BuildKit sin rastro en la imagen |
| `reto-redis-caido.txt` | Resiliencia con Redis detenido |
| `reto-evidencia-final.txt`, `reto-auditoria.txt`, `reto-clon-limpio.txt` | Entregables del reto |
| `ampliacion-trivy.txt` | Escaneo de vulnerabilidades |
