"""Pruebas de la API sin PostgreSQL ni Redis reales.

Se ejecutan en la etapa `test` del Dockerfile:
    docker build --target test -t mercado-api:test ./api
"""
import time
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi.testclient import TestClient

from app import cache, config, main, seguridad

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

    def fetchone(self):
        return self.filas[0] if self.filas else None


def prohibido():
    raise AssertionError("Esta petición no debía llegar a PostgreSQL")


def encabezado(usuario_id=1, nombre="Ana"):
    return {"Authorization": f"Bearer {seguridad.crear_token(usuario_id, nombre)}"}


TIENDA = (1, "Doña Rosa", "Chapinero", "Tienda de barrio", "Fiado y con sonrisa", "/img/tiendas/tienda.jpg")


def test_health_y_trazas():
    respuesta = cliente.get("/health")
    assert respuesta.status_code == 200
    assert respuesta.json() == {"estado": "ok"}
    # El middleware de trazas acompaña cada respuesta
    assert respuesta.headers["Server-Timing"].startswith("app;dur=")
    assert respuesta.headers["X-Atendido-Por"] == main.CONTENEDOR


# ---------------------------------------------------------------- catálogo y caché

def test_tiendas_sin_cache_consulta_bd_y_guarda(monkeypatch):
    guardado = {}
    monkeypatch.setattr(cache, "leer", lambda clave: None)
    monkeypatch.setattr(cache, "guardar", lambda clave, datos: guardado.update({clave: datos}))
    monkeypatch.setattr(main, "obtener_conexion", lambda: ConexionFalsa([TIENDA]))

    respuesta = cliente.get("/tiendas")

    assert respuesta.status_code == 200
    assert respuesta.headers["X-Cache"] == "MISS"
    assert respuesta.json()[0]["imagen_url"] == "/img/tiendas/tienda.jpg"
    assert guardado[main.CLAVE_TIENDAS] == respuesta.json()


def test_tiendas_con_cache_no_toca_bd(monkeypatch):
    monkeypatch.setattr(cache, "leer", lambda clave: [{"id": 9, "nombre": "X", "barrio": "Y"}])
    monkeypatch.setattr(main, "obtener_conexion", prohibido)

    respuesta = cliente.get("/tiendas")

    assert respuesta.headers["X-Cache"] == "HIT"
    assert respuesta.json()[0]["id"] == 9


def test_redis_caido_no_rompe_ni_frena_la_api(monkeypatch):
    # Puerto 1: nadie escucha, la conexión se rechaza de inmediato
    monkeypatch.setattr(cache, "_cliente", cache.crear_cliente("127.0.0.1", 1))
    monkeypatch.setattr(cache, "_pausada_hasta", 0.0)
    monkeypatch.setattr(main, "obtener_conexion", lambda: ConexionFalsa([TIENDA]))

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
    monkeypatch.setattr(main, "obtener_conexion", lambda: ConexionFalsa([TIENDA]))

    cliente.get("/tiendas")  # primer fallo: activa la pausa
    monkeypatch.setattr(cache, "_cliente", RedisQueNoDebeUsarse())
    respuesta = cliente.get("/tiendas")

    assert respuesta.status_code == 200
    assert respuesta.headers["X-Cache"] == "MISS"


# ---------------------------------------------------------------- contraseñas y sesiones

def test_hash_de_clave_verifica_y_no_guarda_la_clave():
    guardada = seguridad.cifrar_clave("clave-segura-123")

    assert guardada.startswith("scrypt$")
    assert "clave-segura-123" not in guardada
    assert seguridad.verificar_clave("clave-segura-123", guardada)
    assert not seguridad.verificar_clave("otra-clave", guardada)
    # Dos usuarios con la misma clave tienen hashes distintos (sal aleatoria)
    assert guardada != seguridad.cifrar_clave("clave-segura-123")


def test_hash_corrupto_no_lanza_error():
    assert not seguridad.verificar_clave("x", "no-es-un-hash")


def test_pedidos_exigen_sesion(monkeypatch):
    monkeypatch.setattr(main, "obtener_conexion", prohibido)

    assert cliente.get("/mis-pedidos").status_code == 401
    assert cliente.get("/pedidos/1").status_code == 401
    respuesta = cliente.post("/pedidos", json={})
    assert respuesta.status_code == 401
    assert respuesta.headers["WWW-Authenticate"] == "Bearer"


def test_token_alterado_se_rechaza(monkeypatch):
    monkeypatch.setattr(main, "obtener_conexion", prohibido)
    token = seguridad.crear_token(1, "Ana")
    # Firmado con otra clave: alguien que no conoce JWT_SECRET intenta hacerse pasar por el usuario 2
    falso = jwt.encode({"sub": "2", "nombre": "Intruso"}, "otra-clave-que-no-es-la-de-la-api-xx", algorithm="HS256")

    assert cliente.get("/mis-pedidos", headers={"Authorization": f"Bearer {falso}"}).status_code == 401
    assert cliente.get("/mis-pedidos", headers={"Authorization": f"Bearer {token[:-2]}xx"}).status_code == 401


def test_token_vencido_se_rechaza(monkeypatch):
    monkeypatch.setattr(main, "obtener_conexion", prohibido)
    hace_un_dia = datetime.now(timezone.utc) - timedelta(days=1)
    vencido = jwt.encode(
        {"sub": "1", "nombre": "Ana", "exp": hace_un_dia}, config.JWT_SECRET, algorithm="HS256"
    )

    respuesta = cliente.get("/mis-pedidos", headers={"Authorization": f"Bearer {vencido}"})

    assert respuesta.status_code == 401
    assert "venció" in respuesta.json()["detail"]


def test_login_con_correo_inexistente_no_revela_nada(monkeypatch):
    monkeypatch.setattr(cache, "contador", lambda clave: 0)
    monkeypatch.setattr(cache, "incrementar", lambda clave, ttl: 1)
    monkeypatch.setattr(main, "obtener_conexion", lambda: ConexionFalsa([]))

    respuesta = cliente.post("/auth/login", json={"email": "nadie@ejemplo.co", "clave": "loquesea123"})

    assert respuesta.status_code == 401
    assert respuesta.json()["detail"] == "Correo o contraseña incorrectos"


def test_login_correcto_entrega_token(monkeypatch):
    guardada = seguridad.cifrar_clave("clave-segura-123")
    monkeypatch.setattr(cache, "contador", lambda clave: 0)
    monkeypatch.setattr(cache, "borrar", lambda clave: None)
    monkeypatch.setattr(main, "obtener_conexion", lambda: ConexionFalsa([(7, "Ana", guardada)]))

    respuesta = cliente.post("/auth/login", json={"email": " Ana@Ejemplo.co ", "clave": "clave-segura-123"})

    assert respuesta.status_code == 200
    datos = respuesta.json()
    assert datos["usuario"] == {"id": 7, "nombre": "Ana", "email": "ana@ejemplo.co"}
    assert jwt.decode(datos["token"], config.JWT_SECRET, algorithms=["HS256"])["sub"] == "7"


def test_login_bloqueado_tras_muchos_fallos(monkeypatch):
    monkeypatch.setattr(cache, "contador", lambda clave: config.LOGIN_MAX_FALLOS)
    monkeypatch.setattr(main, "obtener_conexion", prohibido)

    respuesta = cliente.post("/auth/login", json={"email": "ana@ejemplo.co", "clave": "clave-segura-123"})

    assert respuesta.status_code == 429


@pytest.mark.parametrize(
    "cuenta",
    [
        {"nombre": "Ana", "email": "no-es-correo", "clave": "clave-segura-123"},
        {"nombre": "Ana", "email": "ana@ejemplo.co", "clave": "corta"},
        {"nombre": "", "email": "ana@ejemplo.co", "clave": "clave-segura-123"},
    ],
)
def test_registro_valida_los_datos(monkeypatch, cuenta):
    monkeypatch.setattr(main, "obtener_conexion", prohibido)
    assert cliente.post("/auth/registro", json=cuenta).status_code == 422


# ---------------------------------------------------------------- validación de pedidos

def test_pedido_sin_items_se_rechaza():
    respuesta = cliente.post(
        "/pedidos",
        headers=encabezado(),
        json={"tienda_id": 1, "cliente": "Ana", "direccion": "Cra 7 # 45-10", "items": []},
    )
    assert respuesta.status_code == 422


def test_pedido_con_cantidad_negativa_se_rechaza():
    respuesta = cliente.post(
        "/pedidos",
        headers=encabezado(),
        json={
            "tienda_id": 1,
            "cliente": "Ana",
            "direccion": "Cra 7 # 45-10",
            "items": [{"producto_id": 1, "cantidad": -2}],
        },
    )
    assert respuesta.status_code == 422


def test_pedido_ajeno_no_se_ve(monkeypatch):
    # La consulta filtra por usuario: un pedido de otro devuelve 0 filas → 404
    monkeypatch.setattr(main, "obtener_conexion", lambda: ConexionFalsa([]))

    assert cliente.get("/pedidos/1", headers=encabezado(usuario_id=99)).status_code == 404


# ---------------------------------------------------------------- configuración

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
