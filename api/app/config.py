import os
from pathlib import Path


def leer_secreto(nombre: str) -> str:
    """Busca primero <NOMBRE>_FILE (secreto montado como archivo) y luego la variable."""
    ruta = os.getenv(f"{nombre}_FILE")
    if ruta and Path(ruta).exists():
        return Path(ruta).read_text().strip()
    valor = os.getenv(nombre)
    if valor is None:
        # Fallar es intencional: es peor arrancar con una contraseña por defecto
        raise RuntimeError(f"Falta la configuración {nombre}")
    return valor


DB_HOST = os.getenv("DB_HOST", "db")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
DB_NAME = os.getenv("DB_NAME", "mercado")
DB_USER = os.getenv("DB_USER", "mercado_app")
DB_PASSWORD = leer_secreto("DB_PASSWORD")

REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_PASSWORD = leer_secreto("REDIS_PASSWORD")
CACHE_TTL_SECONDS = int(os.getenv("CACHE_TTL_SECONDS", "60"))

# Clave con la que la API firma los tokens de sesión (JWT). Si se filtra, cualquiera puede
# fabricar sesiones válidas: por eso llega como secreto de Compose, igual que las contraseñas
JWT_SECRET = leer_secreto("JWT_SECRET")
TOKEN_HORAS = int(os.getenv("TOKEN_HORAS", "8"))
# Intentos de inicio de sesión fallidos por correo antes de bloquear (ventana en Redis)
LOGIN_MAX_FALLOS = int(os.getenv("LOGIN_MAX_FALLOS", "5"))
LOGIN_VENTANA_SEGUNDOS = int(os.getenv("LOGIN_VENTANA_SEGUNDOS", "300"))
