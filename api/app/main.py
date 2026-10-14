from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel, Field

from app import cache
from app.db import obtener_conexion

app = FastAPI(title="Mercado Vecino API")

CLAVE_TIENDAS = "catalogo:tiendas"


def clave_productos(tienda_id: int) -> str:
    return f"catalogo:tienda:{tienda_id}:productos"


@app.get("/health")
def health():
    return {"estado": "ok"}


@app.get("/tiendas")
def listar_tiendas(response: Response):
    tiendas = cache.leer(CLAVE_TIENDAS)
    if tiendas is not None:
        response.headers["X-Cache"] = "HIT"
        return tiendas

    with obtener_conexion() as conn:
        filas = conn.execute("SELECT id, nombre, barrio FROM tiendas ORDER BY id").fetchall()
    tiendas = [{"id": f[0], "nombre": f[1], "barrio": f[2]} for f in filas]

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
            "SELECT id, nombre, precio FROM productos WHERE tienda_id = %s ORDER BY id",
            (tienda_id,),
        ).fetchall()
    productos = [{"id": f[0], "nombre": f[1], "precio": f[2]} for f in filas]

    cache.guardar(clave_productos(tienda_id), productos)
    response.headers["X-Cache"] = "MISS"
    return productos


class ItemPedido(BaseModel):
    producto_id: int
    cantidad: int = Field(gt=0, le=99)


class NuevoPedido(BaseModel):
    tienda_id: int
    cliente: str = Field(min_length=1, max_length=120)
    direccion: str = Field(min_length=1, max_length=200)
    items: list[ItemPedido] = Field(min_length=1, max_length=50)


@app.post("/pedidos", status_code=201)
def crear_pedido(pedido: NuevoPedido):
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
            "INSERT INTO pedidos (tienda_id, cliente, direccion, total) "
            "VALUES (%s, %s, %s, %s) RETURNING id",
            (pedido.tienda_id, pedido.cliente, pedido.direccion, total),
        ).fetchone()[0]
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario) "
                "VALUES (%s, %s, %s, %s)",
                [(pedido_id, pid, cant, precios[pid]) for pid, cant in cantidades.items()],
            )

    return {"id": pedido_id, "total": total, "estado": "recibido"}


@app.get("/pedidos/{pedido_id}")
def obtener_pedido(pedido_id: int):
    with obtener_conexion() as conn:
        fila = conn.execute(
            "SELECT p.id, p.tienda_id, t.nombre, p.total, p.estado, p.creado_en "
            "FROM pedidos p JOIN tiendas t ON t.id = p.tienda_id WHERE p.id = %s",
            (pedido_id,),
        ).fetchone()
        if fila is None:
            raise HTTPException(status_code=404, detail="Pedido no encontrado")
        items = conn.execute(
            "SELECT pr.nombre, i.cantidad, i.precio_unitario "
            "FROM pedido_items i JOIN productos pr ON pr.id = i.producto_id "
            "WHERE i.pedido_id = %s ORDER BY pr.nombre",
            (pedido_id,),
        ).fetchall()

    return {
        "id": fila[0],
        "tienda_id": fila[1],
        "tienda": fila[2],
        "total": fila[3],
        "estado": fila[4],
        "creado_en": fila[5].isoformat(),
        "items": [{"producto": i[0], "cantidad": i[1], "precio_unitario": i[2]} for i in items],
    }
