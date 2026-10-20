# syntax=docker/dockerfile:1
# Versión de Python fijada: la imagen no cambia sin aviso (python:latest sí)
ARG PYTHON_VERSION=3.13

# ---------- Etapa 1: builder ----------
# -slim: Debian mínimo, sin compiladores ni herramientas que no se usan en ejecución
FROM python:${PYTHON_VERSION}-slim AS builder
WORKDIR /build
# Entorno virtual aislado: es lo único que pasará a la imagen final
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
# Primero solo requirements.txt: esta capa se reutiliza mientras no cambien las dependencias
COPY requirements.txt .
# --no-cache-dir: la caché de pip no queda guardada dentro de la capa
RUN pip install --no-cache-dir -r requirements.txt

# ---------- Etapa 2: test (opcional) ----------
# docker build --target test ...  Parte del builder y le agrega solo lo de pruebas
FROM builder AS test
COPY requirements-dev.txt .
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY . .
# Valores de mentira válidos solo en este RUN; esta etapa no llega a la imagen final
RUN DB_PASSWORD=solo-pruebas REDIS_PASSWORD=solo-pruebas \
    JWT_SECRET=solo-pruebas-clave-de-firma-de-32-bytes pytest -q

# ---------- Etapa 3: runtime (imagen final) ----------
# Parte de una base limpia: nada del builder llega salvo lo que se copia con --from
FROM python:${PYTHON_VERSION}-slim AS runtime
# No escribir .pyc (el sistema de archivos será de solo lectura) y logs sin búfer
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"
# Usuario sin privilegios con UID/GID fijos (predecibles para permisos y auditoría)
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --no-create-home app
WORKDIR /app
COPY --from=builder /opt/venv /opt/venv
# El código queda como propiedad de root: el usuario app puede leerlo, no modificarlo
COPY app/ ./app/
USER app
EXPOSE 8000
# Docker marca el contenedor como healthy/unhealthy; Compose lo usa en depends_on.
# --start-interval (Engine 25+): durante el arranque revisa cada 2 s, así web no espera 30 s
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --start-interval=2s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1
# Forma exec: Uvicorn es el PID 1, recibe SIGTERM y se apaga limpiamente
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
