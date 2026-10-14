// VITE_API_URL se incrusta en el JavaScript público al compilar: solo URLs, nunca secretos
const BASE = import.meta.env.VITE_API_URL || "/api";

async function pedir(ruta, opciones) {
  const respuesta = await fetch(`${BASE}${ruta}`, opciones);
  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    const detalle = typeof datos?.detail === "string" ? datos.detail : `Error ${respuesta.status}`;
    throw new Error(detalle);
  }
  return { datos, cache: respuesta.headers.get("X-Cache") };
}

export const obtenerTiendas = () => pedir("/tiendas");

export const obtenerProductos = (tiendaId) => pedir(`/tiendas/${tiendaId}/productos`);

export const crearPedido = (pedido) =>
  pedir("/pedidos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pedido),
  });
