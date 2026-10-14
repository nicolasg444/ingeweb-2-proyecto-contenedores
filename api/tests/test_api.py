"""Pruebas de la API sin PostgreSQL ni Redis reales.

Se ejecutan en la etapa `test` del Dockerfile:
    docker build --target test -t mercado-api:test ./api
"""
import time

import pytest
from fastapi.testclient import TestClient

from app import cache, config, main

cliente = TestClient(main.app)


class ConexionFalsa:
    """Imita lo mínimo de psycopg.Connection que usan los endpoints de lectura."""

    def __init__(self, filas):
        self.filas = filas

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, *args, **kwargs):
        return self

    def fetchall(self):
        return self.filas


def test_health():
    respuesta = cliente.get("/health")
    assert respuesta.status_code == 200
    assert respuesta.json() == {"estado": "ok"}


def test_tiendas_sin_cache_consulta_bd_y_guarda(monkeypatch):
    guardado = {}
    monkeypatch.setattr(cache, "leer", lambda clave: None)
    monkeypatch.setattr(cache, "guardar", lambda clave, datos: guardado.update({clave: datos}))
    monkeypatch.setattr(main, "obtener_conexion", lambda: ConexionFalsa([(1, "Doña Rosa", "Chapinero")]))

    respuesta = cliente.get("/tiendas")

    assert respuesta.status_code == 200
    assert respuesta.headers["X-Cache"] == "MISS"
    assert respuesta.json() == [{"id": 1, "nombre": "Doña Rosa", "barrio": "Chapinero"}]
    assert guardado[main.CLAVE_TIENDAS] == respuesta.json()


def test_tiendas_con_cache_no_toca_bd(monkeypatch):
    def prohibido():
        raise AssertionError("Con la caché llena no se debe consultar PostgreSQL")

    monkeypatch.setattr(cache, "leer", lambda clave: [{"id": 9, "nombre": "X", "barrio": "Y"}])
    monkeypatch.setattr(main, "obtener_conexion", prohibido)

    respuesta = cliente.get("/tiendas")

    assert respuesta.headers["X-Cache"] == "HIT"
    assert respuesta.json()[0]["id"] == 9


def test_redis_caido_no_rompe_ni_frena_la_api(monkeypatch):
    # Puerto 1: nadie escucha, la conexión se rechaza de inmediato
    monkeypatch.setattr(cache, "_cliente", cache.crear_cliente("127.0.0.1", 1))
    monkeypatch.setattr(cache, "_pausada_hasta", 0.0)
    monkeypatch.setattr(main, "obtener_conexion", lambda: ConexionFalsa([(1, "A", "B")]))

    inicio = time.monotonic()
    respuesta = cliente.get("/tiendas")
    duracion = time.monotonic() - inicio

    assert respuesta.status_code == 200
    assert respuesta.headers["X-Cache"] == "MISS"
    assert duracion < 2, f"Con Redis caído la petición tardó {duracion:.1f} s (¿reintentos?)"


def test_tras_un_fallo_la_cache_se_omite(monkeypatch):
    class RedisQueNoDebeUsarse:
        def get(self, *args, **kwargs):
            raise AssertionError("Durante la pausa no se debe intentar Redis")

        set = get

    monkeypatch.setattr(cache, "_cliente", cache.crear_cliente("127.0.0.1", 1))
    monkeypatch.setattr(cache, "_pausada_hasta", 0.0)
    monkeypatch.setattr(main, "obtener_conexion", lambda: ConexionFalsa([(1, "A", "B")]))

    cliente.get("/tiendas")  # primer fallo: activa la pausa
    monkeypatch.setattr(cache, "_cliente", RedisQueNoDebeUsarse())
    respuesta = cliente.get("/tiendas")

    assert respuesta.status_code == 200
    assert respuesta.headers["X-Cache"] == "MISS"


def test_pedido_sin_items_se_rechaza():
    respuesta = cliente.post(
        "/pedidos", json={"tienda_id": 1, "cliente": "Ana", "direccion": "Cra 7 # 45-10", "items": []}
    )
    assert respuesta.status_code == 422


def test_pedido_con_cantidad_negativa_se_rechaza():
    respuesta = cliente.post(
        "/pedidos",
        json={
            "tienda_id": 1,
            "cliente": "Ana",
            "direccion": "Cra 7 # 45-10",
            "items": [{"producto_id": 1, "cantidad": -2}],
        },
    )
    assert respuesta.status_code == 422


def test_leer_secreto_prefiere_el_archivo(tmp_path, monkeypatch):
    archivo = tmp_path / "clave.txt"
    archivo.write_text("desde-archivo\n")
    monkeypatch.setenv("PRUEBA_FILE", str(archivo))
    monkeypatch.setenv("PRUEBA", "desde-variable")

    assert config.leer_secreto("PRUEBA") == "desde-archivo"


def test_leer_secreto_falla_si_no_hay_configuracion(monkeypatch):
    monkeypatch.delenv("PRUEBA", raising=False)
    monkeypatch.delenv("PRUEBA_FILE", raising=False)

    with pytest.raises(RuntimeError, match="Falta la configuración PRUEBA"):
        config.leer_secreto("PRUEBA")
