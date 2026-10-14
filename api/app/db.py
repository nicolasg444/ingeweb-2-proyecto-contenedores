import psycopg

from app import config


def obtener_conexion() -> psycopg.Connection:
    """Abre una conexión a PostgreSQL con el rol de la aplicación (no el superusuario).

    Se usa como `with obtener_conexion() as conn:`; al salir del bloque psycopg hace
    commit si no hubo excepción (o rollback si la hubo) y cierra la conexión.
    """
    return psycopg.connect(
        host=config.DB_HOST,
        port=config.DB_PORT,
        dbname=config.DB_NAME,
        user=config.DB_USER,
        password=config.DB_PASSWORD,
        connect_timeout=5,
    )
