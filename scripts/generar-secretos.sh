#!/usr/bin/env bash
# Prepara un clon limpio: crea .env desde .env.example y genera contraseñas aleatorias
# en secrets/ (ignorada por Git). No sobrescribe nada que ya exista.
# Uso (desde la raíz del repositorio; en Windows con Git Bash o WSL):
#   ./scripts/generar-secretos.sh
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
    cp .env.example .env
    echo "Creado .env a partir de .env.example"
fi

mkdir -p secrets

generar() {
    # Hexadecimal: sin caracteres que haya que escapar en URLs ni en archivos de configuración.
    # tr quita el salto de línea: en Windows openssl escribe \r\n y PostgreSQL tomaría
    # el \r como parte de la contraseña.
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 24 | tr -d '\r\n'
    else
        head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \r\n'
    fi
}

for nombre in db_password db_app_password redis_password; do
    archivo="secrets/${nombre}.txt"
    if [ -s "$archivo" ]; then
        echo "Ya existe $archivo (no se toca)"
    else
        generar > "$archivo"
        echo "Generado $archivo"
    fi
done

# Comprobación: Git debe ignorar las credenciales
# (--quiet solo admite una ruta, por eso son dos llamadas)
git check-ignore -q .env 2>/dev/null && git check-ignore -q secrets/db_password.txt 2>/dev/null \
    && echo "OK: .env y secrets/ están ignorados por Git" \
    || echo "AVISO: revise .gitignore; .env o secrets/ no están ignorados" >&2
