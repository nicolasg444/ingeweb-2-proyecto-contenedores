"""Contraseñas y sesiones.

- Contraseñas: hash scrypt (biblioteca estándar) con una sal aleatoria por usuario. scrypt es
  lento y consume memoria a propósito: probar millones de claves robadas sale caro.
- Sesiones: token JWT firmado con HS256 y la clave JWT_SECRET (secreto de Compose). El token
  dice quién es el usuario y cuándo vence; si alguien lo altera, la firma deja de coincidir.
"""
import base64
import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app import config

# Parámetros de scrypt: 2^14 iteraciones y 16 MiB de memoria por intento
_N, _R, _P, _LARGO = 2**14, 8, 1, 32


def _b64(datos: bytes) -> str:
    return base64.b64encode(datos).decode()


def cifrar_clave(clave: str) -> str:
    sal = os.urandom(16)
    resumen = hashlib.scrypt(clave.encode(), salt=sal, n=_N, r=_R, p=_P, dklen=_LARGO)
    # Se guardan los parámetros junto al hash: si mañana se suben, los hashes viejos siguen sirviendo
    return f"scrypt${_N}${_R}${_P}${_b64(sal)}${_b64(resumen)}"


def verificar_clave(clave: str, guardada: str) -> bool:
    try:
        _, n, r, p, sal, resumen = guardada.split("$")
        esperado = base64.b64decode(resumen)
        calculado = hashlib.scrypt(
            clave.encode(), salt=base64.b64decode(sal), n=int(n), r=int(r), p=int(p), dklen=len(esperado)
        )
    except (ValueError, TypeError):
        return False
    # Comparación en tiempo constante: no revela cuántos bytes coincidieron
    return hmac.compare_digest(calculado, esperado)


# Si el correo no existe se verifica contra este hash igual: así la respuesta tarda lo mismo
# y un atacante no puede saber, midiendo el tiempo, qué correos tienen cuenta
HASH_SENUELO = cifrar_clave(os.urandom(16).hex())


def crear_token(usuario_id: int, nombre: str) -> str:
    ahora = datetime.now(timezone.utc)
    datos = {"sub": str(usuario_id), "nombre": nombre, "iat": ahora, "exp": ahora + timedelta(hours=config.TOKEN_HORAS)}
    return jwt.encode(datos, config.JWT_SECRET, algorithm="HS256")


_bearer = HTTPBearer(auto_error=False)


def _no_autorizado(mensaje: str) -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail=mensaje, headers={"WWW-Authenticate": "Bearer"})


def usuario_actual(credenciales: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    """Dependencia de FastAPI: exige un token válido y devuelve {id, nombre}."""
    if credenciales is None:
        raise _no_autorizado("Inicia sesión para continuar")
    try:
        # algorithms fijo: no se acepta "none" ni otro algoritmo que proponga el token
        datos = jwt.decode(credenciales.credentials, config.JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise _no_autorizado("Tu sesión venció, vuelve a ingresar") from None
    except jwt.InvalidTokenError:
        raise _no_autorizado("Sesión inválida") from None
    return {"id": int(datos["sub"]), "nombre": datos["nombre"]}
