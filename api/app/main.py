import platform
import socket
import time

import psycopg
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app import cache, config
from app.db import obtener_conexion
from app.seguridad import HASH_SENUELO, cifrar_clave, crear_token, usuario_actual, verificar_clave

app = FastAPI(title="Mercado Vecino API")

# Nombre del contenedor que atiende (Docker usa el ID corto como hostname). Con
# `docker compose up -d --scale api=3` el panel de ingeniería muestra cómo Nginx reparte
CONTENEDOR = socket.gethostname()

# Las claves llevan versión: si cambia la forma de los datos, se sube a v3 y la caché vieja
# simplemente deja de leerse (vence sola por TTL) en lugar de servir datos con otro formato
CLAVE_TIENDAS = "catalogo:v2:tiendas"
PATRON_EMAIL = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


def clave_productos(tienda_id: int) -> str:
    return f"catalogo:v2:tienda:{tienda_id}:productos"


@app.middleware("http")
async def trazar(request: Request, call_next):
    """Agrega a cada respuesta cuánto tardó la API y qué contenedor la atendió.

    Server-Timing es un encabezado estándar: también aparece en la pestaña Red del navegador.
    """
    inicio = time.perf_counter()
    respuesta = await call_next(request)
    respuesta.headers["Server-Timing"] = f"app;dur={(time.perf_counter() - inicio) * 1000:.1f}"
    respuesta.headers["X-Atendido-Por"] = CONTENEDOR
    return respuesta


@app.get("/health")
def health():
    return {"estado": "ok"}


# ---------------------------------------------------------------- catálogo (público)

@app.get("/tiendas")
def listar_tiendas(response: Response):
    tiendas = cache.leer(CLAVE_TIENDAS)
    if tiendas is not None:
        response.headers["X-Cache"] = "HIT"
        return tiendas

    with obtener_conexion() as conn:
        filas = conn.execute(
            "SELECT id, nombre, barrio, categoria, descripcion, imagen_url FROM tiendas ORDER BY id"
        ).fetchall()
    tiendas = [
        {"id": f[0], "nombre": f[1], "barrio": f[2], "categoria": f[3], "descripcion": f[4], "imagen_url": f[5]}
        for f in filas
    ]

    cache.guardar(CLAVE_TIENDAS, tiendas)
    response.headers["X-Cache"] = "MISS"
    return tiendas


@app.get("/tiendas/{tienda_id}/productos")
def listar_productos(tienda_id: int, response: Response):
    productos = cache.leer(clave_productos(tienda_id))
    if productos is not None:
        response.headers["X-Cache"] = "HIT"
        return productos

    with obtener_conexion() as conn:
        existe = conn.execute("SELECT 1 FROM tiendas WHERE id = %s", (tienda_id,)).fetchone()
        if existe is None:
            raise HTTPException(status_code=404, detail="Tienda no encontrada")
        filas = conn.execute(
            "SELECT id, nombre, precio, imagen_url FROM productos WHERE tienda_id = %s ORDER BY id",
            (tienda_id,),
        ).fetchall()
    productos = [{"id": f[0], "nombre": f[1], "precio": f[2], "imagen_url": f[3]} for f in filas]

    cache.guardar(clave_productos(tienda_id), productos)
    response.headers["X-Cache"] = "MISS"
    return productos


# ---------------------------------------------------------------- cuentas

class NuevaCuenta(BaseModel):
    nombre: str = Field(min_length=2, max_length=80)
    email: str = Field(max_length=120, pattern=PATRON_EMAIL)
    clave: str = Field(min_length=8, max_length=128)


class Credenciales(BaseModel):
    email: str = Field(max_length=120)
    clave: str = Field(max_length=128)


def _sesion(usuario_id: int, nombre: str, email: str) -> dict:
    return {"token": crear_token(usuario_id, nombre), "usuario": {"id": usuario_id, "nombre": nombre, "email": email}}


@app.post("/auth/registro", status_code=201)
def registrar(cuenta: NuevaCuenta):
    email = cuenta.email.strip().lower()
    nombre = cuenta.nombre.strip()
    try:
        with obtener_conexion() as conn:
            usuario_id = conn.execute(
                "INSERT INTO usuarios (nombre, email, clave_hash) VALUES (%s, %s, %s) RETURNING id",
                (nombre, email, cifrar_clave(cuenta.clave)),
            ).fetchone()[0]
    except psycopg.errors.UniqueViolation:
        raise HTTPException(status_code=409, detail="Ya existe una cuenta con ese correo") from None
    return _sesion(usuario_id, nombre, email)


@app.post("/auth/login")
def iniciar_sesion(credenciales: Credenciales):
    email = credenciales.email.strip().lower()
    clave_fallos = f"login:fallos:{email}"
    # Freno a la fuerza bruta: el contador vive en Redis y vence solo. Si Redis está caído
    # el login sigue funcionando (sin freno) en vez de dejar a todos por fuera
    if cache.contador(clave_fallos) >= config.LOGIN_MAX_FALLOS:
        raise HTTPException(status_code=429, detail="Demasiados intentos. Espera unos minutos.")

    with obtener_conexion() as conn:
        fila = conn.execute("SELECT id, nombre, clave_hash FROM usuarios WHERE email = %s", (email,)).fetchone()

    if not verificar_clave(credenciales.clave, fila[2] if fila else HASH_SENUELO) or fila is None:
        cache.incrementar(clave_fallos, config.LOGIN_VENTANA_SEGUNDOS)
        # Mismo mensaje si el correo no existe o la clave está mal: no se revela cuál de los dos
        raise HTTPException(status_code=401, detail="Correo o contraseña incorrectos")

    cache.borrar(clave_fallos)
    return _sesion(fila[0], fila[1], email)


@app.get("/auth/yo")
def quien_soy(usuario: dict = Depends(usuario_actual)):
    with obtener_conexion() as conn:
        fila = conn.execute("SELECT id, nombre, email FROM usuarios WHERE id = %s", (usuario["id"],)).fetchone()
    if fila is None:
        raise HTTPException(status_code=401, detail="Sesión inválida")
    return {"id": fila[0], "nombre": fila[1], "email": fila[2]}


# ---------------------------------------------------------------- pedidos (requieren sesión)

class ItemPedido(BaseModel):
    producto_id: int
    cantidad: int = Field(gt=0, le=99)


class NuevoPedido(BaseModel):
    tienda_id: int
    cliente: str = Field(min_length=1, max_length=120)
    direccion: str = Field(min_length=1, max_length=200)
    items: list[ItemPedido] = Field(min_length=1, max_length=50)


@app.post("/pedidos", status_code=201)
def crear_pedido(pedido: NuevoPedido, usuario: dict = Depends(usuario_actual)):
    # Si el mismo producto viene dos veces se suman las cantidades
    cantidades: dict[int, int] = {}
    for item in pedido.items:
        cantidades[item.producto_id] = cantidades.get(item.producto_id, 0) + item.cantidad

    with obtener_conexion() as conn:
        # El precio sale de la base de datos, nunca del cliente
        filas = conn.execute(
            "SELECT id, precio FROM productos WHERE tienda_id = %s AND id = ANY(%s)",
            (pedido.tienda_id, list(cantidades)),
        ).fetchall()
        precios = {f[0]: f[1] for f in filas}
        faltantes = sorted(set(cantidades) - precios.keys())
        if faltantes:
            raise HTTPException(
                status_code=422,
                detail=f"Productos inexistentes en la tienda {pedido.tienda_id}: {faltantes}",
            )

        total = sum(precios[pid] * cant for pid, cant in cantidades.items())
        pedido_id = conn.execute(
            "INSERT INTO pedidos (usuario_id, tienda_id, cliente, direccion, total) "
            "VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (usuario["id"], pedido.tienda_id, pedido.cliente, pedido.direccion, total),
        ).fetchone()[0]
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario) "
                "VALUES (%s, %s, %s, %s)",
                [(pedido_id, pid, cant, precios[pid]) for pid, cant in cantidades.items()],
            )

    return {"id": pedido_id, "total": total, "estado": "recibido"}


def _items_de(conn, pedido_ids: list[int]) -> dict[int, list[dict]]:
    filas = conn.execute(
        "SELECT i.pedido_id, pr.nombre, pr.imagen_url, i.cantidad, i.precio_unitario "
        "FROM pedido_items i JOIN productos pr ON pr.id = i.producto_id "
        "WHERE i.pedido_id = ANY(%s) ORDER BY pr.nombre",
        (pedido_ids,),
    ).fetchall()
    items: dict[int, list[dict]] = {pid: [] for pid in pedido_ids}
    for f in filas:
        items[f[0]].append({"producto": f[1], "imagen_url": f[2], "cantidad": f[3], "precio_unitario": f[4]})
    return items


def _pedido(fila, items) -> dict:
    return {
        "id": fila[0],
        "tienda_id": fila[1],
        "tienda": fila[2],
        "cliente": fila[3],
        "direccion": fila[4],
        "total": fila[5],
        "estado": fila[6],
        "creado_en": fila[7].isoformat(),
        "items": items,
    }


_SELECT_PEDIDO = (
    "SELECT p.id, p.tienda_id, t.nombre, p.cliente, p.direccion, p.total, p.estado, p.creado_en "
    "FROM pedidos p JOIN tiendas t ON t.id = p.tienda_id "
)


@app.get("/mis-pedidos")
def mis_pedidos(usuario: dict = Depends(usuario_actual)):
    with obtener_conexion() as conn:
        filas = conn.execute(
            _SELECT_PEDIDO + "WHERE p.usuario_id = %s ORDER BY p.creado_en DESC LIMIT 50",
            (usuario["id"],),
        ).fetchall()
        items = _items_de(conn, [f[0] for f in filas]) if filas else {}
    return [_pedido(f, items[f[0]]) for f in filas]


@app.get("/pedidos/{pedido_id}")
def obtener_pedido(pedido_id: int, usuario: dict = Depends(usuario_actual)):
    with obtener_conexion() as conn:
        # Filtrar también por usuario: sin esto, cualquiera vería pedidos ajenos cambiando el número
        fila = conn.execute(
            _SELECT_PEDIDO + "WHERE p.id = %s AND p.usuario_id = %s",
            (pedido_id, usuario["id"]),
        ).fetchone()
        if fila is None:
            raise HTTPException(status_code=404, detail="Pedido no encontrado")
        items = _items_de(conn, [pedido_id])
    return _pedido(fila, items[pedido_id])


# ---------------------------------------------------------------- panel de ingeniería

@app.get("/sistema")
def sistema():
    """Estado de los contenedores que ve la API: lo consume el «Modo ingeniero» del frontend."""
    estado = {
        "api": {"contenedor": CONTENEDOR, "python": platform.python_version()},
        "cache_ttl": config.CACHE_TTL_SECONDS,
    }
    inicio = time.perf_counter()
    try:
        with obtener_conexion() as conn:
            version = conn.execute("SHOW server_version").fetchone()[0]
            pedidos = conn.execute("SELECT count(*) FROM pedidos").fetchone()[0]
        estado["db"] = {
            "ok": True,
            "ms": round((time.perf_counter() - inicio) * 1000, 1),
            "version": version.split()[0],
            "pedidos": pedidos,
        }
    except psycopg.Error:
        estado["db"] = {"ok": False}
    estado["redis"] = cache.diagnostico()
    return estado
