# Guion de socialización (3 minutos)

La rúbrica pide **explicar una decisión técnica y la alternativa descartada**. El guion tiene
cuatro bloques de unos 45 segundos. En la presentación, cada línea del Dockerfile debe poder
justificarse sin apoyo: los comentarios de `api/Dockerfile` y `frontend/Dockerfile` sirven para
repasar.

## 1. El problema y el resultado (0:00–0:45)

- Mercado Vecino tenía el clásico «en mi máquina sí funciona» y una puesta en producción que falló
  por una variable faltante.
- Ahora: **4 contenedores con un solo comando** (`docker compose up -d --build`), healthy en ~14 s.
- Cifras: la imagen de la API pasó de **1,78 GB a 286 MB**; la reconstrucción tras un cambio de
  código, de **20 s a 1,8 s**; las vulnerabilidades, de **3 695 a 172** (Trivy); y ninguna
  contraseña en Git, imágenes ni variables (auditoría sin hallazgos).
- Mostrar en vivo: `docker compose ps` y la página con la etiqueta "desde Redis".

## 2. Decisión 1: secretos como archivo y un rol por servicio (0:45–1:30)

- **Elegimos:** secretos de Compose montados en `/run/secrets/`, y **tres** secretos distintos. La
  API usa el rol `mercado_app` (solo `SELECT` e `INSERT` donde hace falta) y **nunca recibe** la
  contraseña del superusuario.
- **Descartamos:** la contraseña en `.env` como variable de entorno. Demostramos que aparece en
  `docker inspect`, `docker compose config` y `/proc/1/environ` (Ejercicio 6, Paso 1).
- **Por qué importa:** si alguien compromete la API, no puede borrar pedidos, cambiar precios ni
  crear tablas. Probado: `UPDATE`, `DELETE` y `DROP` dan `permission denied`.

## 3. Decisión 2: la caché nunca debe tumbar la API (1:30–2:15)

- **Elegimos:** si Redis falla, la API responde desde PostgreSQL y omite Redis por 30 s
  (cortacircuitos).
- **Descartamos:** dejar la configuración por defecto. Al detener Redis, **cada petición tardaba
  12 s** (reintentos de redis-py + 8 s de DNS en la red interna). Lo encontramos probando, no
  leyendo.
- Resultado: primera petición 1 s y las siguientes 13 ms, todas `200`.
- Detalle de seguridad: la contraseña de Redis no va en `--requirepass` (se vería en `ps`), sino en
  un archivo de configuración dentro de un tmpfs.

## 4. Lo que aprendimos (2:15–3:00)

- **`latest` no es una versión:** el Dockerfile ingenuo dejó de construir porque hoy `latest` es
  Python 3.15.
- **Fijar no basta, hay que mantener:** la `nginx-unprivileged:1.27` del enunciado tenía 2 CRITICAL;
  con la rama estable 1.30 quedan 0.
- **Sin volumen nombrado los datos no se borran: se pierden de vista** (volumen anónimo huérfano).
- Cierre: «un compañero puede levantar todo desde un clon limpio con tres comandos».

## Preguntas probables y respuestas cortas

| Pregunta | Respuesta |
|---|---|
| ¿Por qué `-slim` y no `alpine` para Python? | Alpine usa musl. Muchas ruedas (wheels) de Python se publican para glibc y en Alpine habría que compilarlas, lo que hace la construcción más lenta y frágil. `-slim` es Debian mínimo con glibc |
| ¿Por qué más capas en la imagen optimizada? | Son metadatos de 0 B (`USER`, `HEALTHCHECK`, `ENV`); importan el peso y la base, no el número |
| ¿Por qué el puerto 8080 y no 80? | El Nginx no es root, y los puertos < 1024 requieren privilegios |
| ¿El `.env` es seguro si está en `.gitignore`? | No: termina en `docker inspect` y `/proc/1/environ`; por eso no tiene contraseñas |
| ¿Qué pasa si cambian `01_esquema.sql`? | No se aplica con el volumen existente; se usan migraciones (o `down -v` en desarrollo) |
