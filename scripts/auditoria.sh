#!/usr/bin/env bash
# Auditoría de credenciales (Ejercicio 6, Paso 5, y evidencia del reto).
#
# Parte 1: los tres comandos del enunciado. Encuentran PALABRAS como "password" o
#          "secret" (nombres de variables, rutas /run/secrets/...); hay que leerlas.
# Parte 2: prueba fuerte. Busca el VALOR real de cada secreto en el historial de Git,
#          en el historial y el sistema de archivos de las imágenes y en el entorno de
#          los contenedores. Si un valor aparece, es una fuga; la salida es 1.
#
# Uso (desde la raíz, con el stack levantado):  ./scripts/auditoria.sh
set -uo pipefail
cd "$(dirname "$0")/.."

echo "=== Parte 1: comandos del enunciado (coincidencias por nombre) ==="
echo "--- git log -p | grep -iE \"password|secret|token\""
echo "$(git log -p | grep -ciE "password|secret|token") líneas mencionan esas palabras (nombres de variables, rutas, documentación)."
echo "Valores asignados a variables *PASSWORD*/*SECRET*/*TOKEN* en todo el historial (veces | valor):"
# Extrae CLAVE=valor o CLAVE: valor y muestra cada valor distinto una vez, para revisarlos de un vistazo
git log -p --all | grep -E '^\+' \
    | grep -oE '[A-Z_]*(PASSWORD|SECRET|TOKEN)[A-Z_]*"?[=:] ?[^ ",;)}]+' \
    | sed -E 's/^[A-Z_]+"?[=:] ?//' | sort | uniq -c | sort -rn
echo "(Esperado: solo rutas /run/secrets/..., \${VAR}, <REDACTADA> y valores de prueba como solo-pruebas)"
echo
echo "--- git ls-files | grep -E \"\\.env\$|secrets/\""
git ls-files | grep -E "\.env$|secrets/" || echo "(sin archivos .env ni secrets/ versionados)"
echo
echo "--- docker history --no-trunc mercado-api:1.0 | grep -iE \"password|token\""
docker history --no-trunc mercado-api:1.0 | grep -iE "password|token" || echo "(sin coincidencias)"
echo

echo "=== Parte 2: búsqueda de los valores reales de los secretos ==="
fugas=0
for archivo in secrets/*.txt; do
    nombre=$(basename "$archivo" .txt)
    valor=$(tr -d '\r\n' < "$archivo")
    [ -z "$valor" ] && continue

    revisar() {
        local donde=$1 texto=$2
        if printf '%s' "$texto" | grep -qF "$valor"; then
            echo "FUGA: $nombre aparece en $donde"
            fugas=$((fugas + 1))
        else
            echo "ok   $nombre no aparece en $donde"
        fi
    }

    revisar "el historial de Git (git log -p --all)" "$(git log -p --all 2>/dev/null)"
    for imagen in mercado-api:1.0 mercado-web:1.0; do
        revisar "docker history de $imagen" "$(docker history --no-trunc "$imagen" 2>/dev/null)"
        revisar "docker image inspect de $imagen" "$(docker image inspect "$imagen" 2>/dev/null)"
    done
    # Sistema de archivos de las imágenes (contenedor temporal, sin secretos montados).
    # El valor entra por stdin para no dejarlo en los argumentos del contenedor.
    for imagen in mercado-api:1.0 mercado-web:1.0; do
        encontrados=$(printf '%s' "$valor" | docker run -i --rm --entrypoint sh "$imagen" -c \
            'v=$(cat); grep -rlF -- "$v" /app /opt/venv /usr/share/nginx /etc /home /root /tmp 2>/dev/null' || true)
        if [ -n "$encontrados" ]; then
            echo "FUGA: $nombre aparece en archivos de $imagen: $encontrados"
            fugas=$((fugas + 1))
        else
            echo "ok   $nombre no aparece en los archivos de $imagen"
        fi
    done
    for servicio in db redis api web; do
        id=$(docker compose ps -q "$servicio" 2>/dev/null)
        [ -z "$id" ] && continue
        revisar "docker inspect (Config.Env) de $servicio" "$(docker inspect --format '{{json .Config.Env}} {{json .Config.Cmd}}' "$id")"
    done
done

echo
if [ "$fugas" -eq 0 ]; then
    echo "RESULTADO: sin hallazgos. Ningún valor de secreto aparece en Git, imágenes ni variables."
else
    echo "RESULTADO: $fugas fuga(s). Cambie las contraseñas afectadas: borrar el commit no basta."
    exit 1
fi
