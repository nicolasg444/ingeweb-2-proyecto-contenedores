#!/bin/sh
# Crea el rol de la aplicación con mínimo privilegio (reto integrador).
#
# - Lo ejecuta la imagen de PostgreSQL después de 01_esquema.sql, solo con el volumen vacío.
# - El superusuario (POSTGRES_USER) queda solo para administrar; la API nunca lo usa.
# - La contraseña se lee del secreto montado en /run/secrets: no pasa por variables de
#   entorno ni por argumentos de proceso (psql la lee con \set y comillas invertidas).
# - Sin `set -u` ni `set -e`: si la imagen decide hacer `source` de este archivo,
#   esas opciones afectarían al entrypoint. Los errores se manejan de forma explícita.

APP_DB_PASSWORD_FILE="${APP_DB_PASSWORD_FILE:-/run/secrets/db_app_password}"
export APP_DB_PASSWORD_FILE

if [ -z "${APP_DB_USER:-}" ]; then
    echo "02_rol_app.sh: falta la variable APP_DB_USER" >&2
    exit 1
fi
if [ ! -s "$APP_DB_PASSWORD_FILE" ]; then
    echo "02_rol_app.sh: falta el secreto $APP_DB_PASSWORD_FILE" >&2
    exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'EOSQL' || exit 1
\getenv app_user APP_DB_USER
\getenv db_name POSTGRES_DB
\set app_password `cat "$APP_DB_PASSWORD_FILE"`

-- Rol que solo puede iniciar sesión: no es superusuario, no crea bases ni roles
CREATE ROLE :"app_user" LOGIN PASSWORD :'app_password'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- Nadie más que los roles autorizados se conecta a la base
REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db_name" TO :"app_user";

-- Puede usar el esquema, pero no crear objetos en él
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app_user";

-- Catálogo: solo lectura. Usuarios y pedidos: leer y crear; nunca modificar ni borrar
GRANT SELECT ON tiendas, productos TO :"app_user";
GRANT SELECT, INSERT ON usuarios, pedidos, pedido_items TO :"app_user";
GRANT USAGE ON SEQUENCE usuarios_id_seq, pedidos_id_seq TO :"app_user";
EOSQL

echo "02_rol_app.sh: rol '$APP_DB_USER' creado con permisos mínimos"
