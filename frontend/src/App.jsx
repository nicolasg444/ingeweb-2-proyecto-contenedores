import { useEffect, useState } from "react";
import { crearPedido, obtenerProductos, obtenerTiendas } from "./api.js";

const pesos = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

function IndicadorCache({ valor }) {
  if (!valor) return null;
  const hit = valor === "HIT";
  return (
    <span className={`cache ${hit ? "cache-hit" : "cache-miss"}`}>
      {hit ? "desde Redis" : "desde PostgreSQL"}
    </span>
  );
}

export default function App() {
  const [tiendas, setTiendas] = useState([]);
  const [cacheTiendas, setCacheTiendas] = useState(null);
  const [tienda, setTienda] = useState(null);
  const [productos, setProductos] = useState([]);
  const [cacheProductos, setCacheProductos] = useState(null);
  const [carrito, setCarrito] = useState({});
  const [cliente, setCliente] = useState("");
  const [direccion, setDireccion] = useState("");
  const [error, setError] = useState("");
  const [confirmacion, setConfirmacion] = useState(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    obtenerTiendas()
      .then(({ datos, cache }) => {
        setTiendas(datos);
        setCacheTiendas(cache);
      })
      .catch((e) => setError(`No se pudo cargar el catálogo: ${e.message}`));
  }, []);

  function elegirTienda(t) {
    setTienda(t);
    setCarrito({});
    setConfirmacion(null);
    setError("");
    obtenerProductos(t.id)
      .then(({ datos, cache }) => {
        setProductos(datos);
        setCacheProductos(cache);
      })
      .catch((e) => setError(`No se pudieron cargar los productos: ${e.message}`));
  }

  function cambiarCantidad(productoId, delta) {
    setCarrito((actual) => {
      const cantidad = Math.max(0, Math.min(99, (actual[productoId] || 0) + delta));
      const siguiente = { ...actual, [productoId]: cantidad };
      if (cantidad === 0) delete siguiente[productoId];
      return siguiente;
    });
  }

  const lineas = productos
    .filter((p) => carrito[p.id])
    .map((p) => ({ ...p, cantidad: carrito[p.id], subtotal: p.precio * carrito[p.id] }));
  const total = lineas.reduce((suma, l) => suma + l.subtotal, 0);

  async function enviarPedido(evento) {
    evento.preventDefault();
    setEnviando(true);
    setError("");
    try {
      const { datos } = await crearPedido({
        tienda_id: tienda.id,
        cliente,
        direccion,
        items: lineas.map((l) => ({ producto_id: l.id, cantidad: l.cantidad })),
      });
      setConfirmacion(datos);
      setCarrito({});
    } catch (e) {
      setError(`No se pudo crear el pedido: ${e.message}`);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="pagina">
      <header className="cabecera">
        <h1>Mercado Vecino</h1>
        <p>Pedidos a domicilio de las tiendas de tu barrio en Bogotá</p>
      </header>

      {error && <p className="error">{error}</p>}

      <section>
        <h2>
          Tiendas <IndicadorCache valor={cacheTiendas} />
        </h2>
        <ul className="tiendas">
          {tiendas.map((t) => (
            <li key={t.id}>
              <button
                className={`tienda ${tienda?.id === t.id ? "activa" : ""}`}
                onClick={() => elegirTienda(t)}
              >
                <strong>{t.nombre}</strong>
                <span>{t.barrio}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {tienda && (
        <div className="columnas">
          <section>
            <h2>
              Productos de {tienda.nombre} <IndicadorCache valor={cacheProductos} />
            </h2>
            <ul className="productos">
              {productos.map((p) => (
                <li key={p.id} className="producto">
                  <div>
                    <strong>{p.nombre}</strong>
                    <span>{pesos.format(p.precio)}</span>
                  </div>
                  <div className="contador">
                    <button onClick={() => cambiarCantidad(p.id, -1)} aria-label={`Quitar ${p.nombre}`}>
                      −
                    </button>
                    <span>{carrito[p.id] || 0}</span>
                    <button onClick={() => cambiarCantidad(p.id, 1)} aria-label={`Agregar ${p.nombre}`}>
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="carrito">
            <h2>Carrito</h2>
            {confirmacion ? (
              <div className="confirmacion">
                <p>
                  Pedido <strong>#{confirmacion.id}</strong> {confirmacion.estado}.
                </p>
                <p>Total: {pesos.format(confirmacion.total)}</p>
              </div>
            ) : lineas.length === 0 ? (
              <p className="vacio">Agrega productos para hacer tu pedido.</p>
            ) : (
              <form onSubmit={enviarPedido}>
                <ul className="lineas">
                  {lineas.map((l) => (
                    <li key={l.id}>
                      <span>
                        {l.cantidad} × {l.nombre}
                      </span>
                      <span>{pesos.format(l.subtotal)}</span>
                    </li>
                  ))}
                </ul>
                <p className="total">
                  <span>Total</span>
                  <strong>{pesos.format(total)}</strong>
                </p>
                <label>
                  Nombre
                  <input value={cliente} onChange={(e) => setCliente(e.target.value)} required maxLength={120} />
                </label>
                <label>
                  Dirección
                  <input
                    value={direccion}
                    onChange={(e) => setDireccion(e.target.value)}
                    required
                    maxLength={200}
                    placeholder="Cra 7 # 45-10"
                  />
                </label>
                <button type="submit" className="pedir" disabled={enviando}>
                  {enviando ? "Enviando…" : "Hacer pedido"}
                </button>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
