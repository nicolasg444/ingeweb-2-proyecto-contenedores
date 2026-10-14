"""Caché del catálogo en Redis.

La caché es una optimización: si Redis no responde, la API registra la advertencia
y sigue sirviendo desde PostgreSQL en lugar de fallar.

Tras un fallo, la caché se omite durante PAUSA_TRAS_FALLO segundos (cortacircuitos):
con el contenedor de Redis detenido, resolver el nombre `redis` en la red interna
tarda varios segundos y sin esta pausa lo pagaría cada petición.
"""
import json
import logging
import time

import redis
from redis.backoff import NoBackoff
from redis.retry import Retry

from app import config

log = logging.getLogger("mercado.cache")

PAUSA_TRAS_FALLO = 30
_pausada_hasta = 0.0


def crear_cliente(host: str, port: int, password: str | None = None) -> redis.Redis:
    # Sin reintentos: redis-py reintenta con espera por defecto y, con Redis caído,
    # cada petición tardaba ~8 s. Mejor fallar rápido y seguir contra PostgreSQL.
    return redis.Redis(
        host=host,
        port=port,
        password=password,
        socket_timeout=1,
        socket_connect_timeout=1,
        retry=Retry(NoBackoff(), 0),
        decode_responses=True,
    )


# redis.Redis no abre la conexión al crearse, solo en el primer comando
_cliente = crear_cliente(config.REDIS_HOST, config.REDIS_PORT, config.REDIS_PASSWORD)


def _disponible() -> bool:
    return time.monotonic() >= _pausada_hasta


def _registrar_fallo(operacion: str, clave: str, error: Exception) -> None:
    global _pausada_hasta
    _pausada_hasta = time.monotonic() + PAUSA_TRAS_FALLO
    log.warning(
        "Redis no disponible al %s %s: %s. Se omite la caché por %d s",
        operacion, clave, error, PAUSA_TRAS_FALLO,
    )


def leer(clave: str):
    if not _disponible():
        return None
    try:
        valor = _cliente.get(clave)
    except redis.RedisError as error:
        _registrar_fallo("leer", clave, error)
        return None
    return json.loads(valor) if valor is not None else None


def guardar(clave: str, datos, ttl: int = config.CACHE_TTL_SECONDS) -> None:
    if not _disponible():
        return
    try:
        _cliente.set(clave, json.dumps(datos), ex=ttl)
    except redis.RedisError as error:
        _registrar_fallo("guardar", clave, error)
