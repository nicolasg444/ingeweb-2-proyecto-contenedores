import { useCallback, useEffect, useState } from "react";
import { crearPedido, guardarSesion, leerSesion, obtenerProductos, obtenerTiendas, quienSoy } from "./api.js";
import Acceso from "./componentes/Acceso.jsx";
import Carrito from "./componentes/Carrito.jsx";
import Foto from "./componentes/Foto.jsx";
import MisPedidos from "./componentes/MisPedidos.jsx";
import ModoIngeniero from "./componentes/ModoIngeniero.jsx";
import { iniciales, pesos } from "./formato.js";

const vistaDesdeHash = () => (window.location.hash === "#/pedidos" ? "pedidos" : "catalogo");

function IndicadorCache({ valor }) {
  if (!valor) return null;
  const hit = valor === "HIT";
  return (
    <span className={`cache ${hit ? "cache-hit" : "cache-miss"}`} title={hit ? "Respuesta servida por Redis" : "Consultado en PostgreSQL y guardado en Redis"}>
      {hit ? "⚡ desde Redis" : "🐘 desde PostgreSQL"}
    </span>
  );
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 40 40" aria-hidden="true">
      <path d="M4 15 L8 6 H32 L36 15 Z" className="logo-toldo" />
      <path d="M8 6 L10 15 M14 6 L15 15 M20 6 V15 M26 6 L25 15 M32 6 L30 15" className="logo-rayas" />
      <rect x="7" y="15" width="26" height="19" rx="2" className="logo-casa" />
      <rect x="16" y="22" width="8" height="12" rx="1" className="logo-puerta" />
    </svg>
  );
}

export default function App() {
  const [sesion, setSesion] = useState(leerSesion);
  const [vista, setVista] = useState(vistaDesdeHash);
  const [tiendas, setTiendas] = useState(null);
  const [cacheTiendas, setCacheTiendas] = useState(null);
  const [tiendaId, setTiendaId] = useState(null);
  const [productos, setProductos] = useState(null);
  const [cacheProductos, setCacheProductos] = useState(null);
  const [carrito, setCarrito] = useState({ tiendaId: null, items: {} });
  const [carritoAbierto, setCarritoAbierto] = useState(false);
  const [acceso, setAcceso] = useState(null); // { modo, motivo } cuando la ventana está abierta
  const [ingeniero, setIngeniero] = useState(false);
  const [error, setError] = useState("");

  // ---------------------------------------------------------------- navegación por #hash
  useEffect(() => {
    const alCambiar = () => setVista(vistaDesdeHash());
    window.addEventListener("hashchange", alCambiar);
    return () => window.removeEventListener("hashchange", alCambiar);
  }, []);
  const ir = (destino) => {
    window.location.hash = destino === "pedidos" ? "#/pedidos" : "#/";
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ---------------------------------------------------------------- sesión
  const cambiarSesion = useCallback((nueva) => {
    guardarSesion(nueva);
    setSesion(nueva);
  }, []);

  const sesionVencida = useCallback(
    (motivo) => {
      cambiarSesion(null);
      setAcceso({ modo: "ingresar", motivo });
    },
    [cambiarSesion],
  );

  // Al abrir la página se confirma que el token guardado siga siendo válido
  useEffect(() => {
    if (!sesion) return;
    quienSoy(sesion.token).catch((err) => err.estado === 401 && cambiarSesion(null));
  }, []);

  // ---------------------------------------------------------------- catálogo
  useEffect(() => {
    obtenerTiendas()
      .then(({ datos, cache }) => {
        setTiendas(datos);
        setCacheTiendas(cache);
        setTiendaId((actual) => actual ?? datos[0]?.id ?? null);
      })
      .catch((e) => setError(`No se pudo cargar el catálogo: ${e.message}`));
  }, []);

  useEffect(() => {
    if (tiendaId === null) return;
    setProductos(null);
    obtenerProductos(tiendaId)
      .then(({ datos, cache }) => {
        setProductos(datos);
        setCacheProductos(cache);
      })
      .catch((e) => setError(`No se pudieron cargar los productos: ${e.message}`));
  }, [tiendaId]);

  const tienda = tiendas?.find((t) => t.id === tiendaId);
  const tiendaCarrito = tiendas?.find((t) => t.id === carrito.tiendaId);

  // ---------------------------------------------------------------- canasta
  // Un pedido es de una sola tienda: si se agrega de otra, se pregunta antes de vaciar
  function cambiarCantidad(producto, delta, deTienda = carrito.tiendaId ?? tiendaId) {
    if (carrito.tiendaId && deTienda !== carrito.tiendaId && Object.keys(carrito.items).length) {
      const ok = window.confirm(
        `Tu canasta tiene productos de ${tiendaCarrito?.nombre}. ¿La vacías para pedir en ${tienda?.nombre}?`,
      );
      if (!ok) return;
      setCarrito({ tiendaId: deTienda, items: { [producto.id]: { producto, cantidad: 1 } } });
      return;
    }
    setCarrito((actual) => {
      const cantidad = Math.max(0, Math.min(99, (actual.items[producto.id]?.cantidad ?? 0) + delta));
      const items = { ...actual.items, [producto.id]: { producto, cantidad } };
      if (cantidad === 0) delete items[producto.id];
      return { tiendaId: Object.keys(items).length ? deTienda : null, items };
    });
  }

  const lineas = Object.values(carrito.items);
  const unidades = lineas.reduce((suma, l) => suma + l.cantidad, 0);

  async function pedir({ cliente, direccion }) {
    try {
      const { datos } = await crearPedido(
        {
          tienda_id: carrito.tiendaId,
          cliente,
          direccion,
          items: lineas.map((l) => ({ producto_id: l.producto.id, cantidad: l.cantidad })),
        },
        sesion.token,
      );
      setCarrito({ tiendaId: null, items: {} });
      return datos;
    } catch (err) {
      if (err.estado === 401) {
        setCarritoAbierto(false);
        sesionVencida(err.message);
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------- vista
  return (
    <div className={`app ${ingeniero ? "con-ingeniero" : ""}`}>
      <div className="toldo" aria-hidden="true" />
      <header className="barra">
        <div className="barra-interior">
          <button className="marca" onClick={() => ir("catalogo")}>
            <Logo />
            <span>
              Mercado <b>Vecino</b>
            </span>
          </button>

          <nav className="navegacion" aria-label="Secciones">
            <button aria-current={vista === "catalogo" ? "page" : undefined} onClick={() => ir("catalogo")}>
              Tiendas
            </button>
            <button
              aria-current={vista === "pedidos" ? "page" : undefined}
              onClick={() => (sesion ? ir("pedidos") : setAcceso({ modo: "ingresar", motivo: "Ingresa para ver tus pedidos." }))}
            >
              Mis pedidos
            </button>
          </nav>

          <div className="barra-acciones">
            <button
              className={`boton-ing ${ingeniero ? "activo" : ""}`}
              onClick={() => setIngeniero((v) => !v)}
              aria-pressed={ingeniero}
              title="Ver cómo viaja cada petición entre los contenedores"
            >
              <span aria-hidden="true">{">_"}</span> <span className="ocultar-movil">Modo ingeniero</span>
            </button>

            {sesion ? (
              <div className="usuario">
                <span className="avatar" title={sesion.usuario.email}>
                  {iniciales(sesion.usuario.nombre)}
                </span>
                <span className="ocultar-movil">{sesion.usuario.nombre.split(" ")[0]}</span>
                <button
                  className="boton-texto"
                  onClick={() => {
                    cambiarSesion(null);
                    if (vista === "pedidos") ir("catalogo");
                  }}
                >
                  Salir
                </button>
              </div>
            ) : (
              <button className="boton boton-borde" onClick={() => setAcceso({ modo: "ingresar" })}>
                Ingresar
              </button>
            )}

            <button className="boton-canasta" onClick={() => setCarritoAbierto(true)} aria-label={`Canasta, ${unidades} productos`}>
              🧺
              {unidades > 0 && <span className="insignia">{unidades}</span>}
            </button>
          </div>
        </div>
      </header>

      <main className="contenido">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {vista === "pedidos" && sesion ? (
          <MisPedidos sesion={sesion} onSesionVencida={sesionVencida} onIrCatalogo={() => ir("catalogo")} />
        ) : (
          <>
            <section className="heroe">
              <p className="antetitulo">Bogotá · pedidos a domicilio</p>
              <h1>
                La tienda de la esquina,
                <br />
                <em>ahora a un clic.</em>
              </h1>
              <p className="heroe-texto">
                {sesion ? `Hola, ${sesion.usuario.nombre.split(" ")[0]}. ` : ""}
                Pide a las tiendas de tu barrio y recibe en la puerta. Cada pedido queda guardado en tu cuenta.
              </p>
            </section>

            <section aria-labelledby="titulo-tiendas">
              <h2 id="titulo-tiendas" className="titulo-seccion">
                Tiendas del barrio <IndicadorCache valor={cacheTiendas} />
              </h2>
              <ul className="tiendas">
                {(tiendas ?? Array.from({ length: 5 }, (_, i) => ({ id: -i }))).map((t) => (
                  <li key={t.id}>
                    {t.nombre ? (
                      <button className={`tienda ${t.id === tiendaId ? "activa" : ""}`} onClick={() => setTiendaId(t.id)} aria-pressed={t.id === tiendaId}>
                        <Foto src={t.imagen_url} alt={t.nombre} className="tienda-foto" />
                        <span className="tienda-texto">
                          <span className="tienda-categoria">{t.categoria}</span>
                          <strong>{t.nombre}</strong>
                          <span>📍 {t.barrio}</span>
                        </span>
                      </button>
                    ) : (
                      <div className="tienda esqueleto" />
                    )}
                  </li>
                ))}
              </ul>
            </section>

            {tienda && (
              <section aria-labelledby="titulo-productos" className="seccion-productos">
                <div className="productos-cabecera">
                  <div>
                    <h2 id="titulo-productos" className="titulo-seccion">
                      {tienda.nombre} <IndicadorCache valor={cacheProductos} />
                    </h2>
                    <p className="suave">{tienda.descripcion}</p>
                  </div>
                </div>
                <ul className="productos">
                  {(productos ?? Array.from({ length: 4 }, (_, i) => ({ id: -i }))).map((p) => {
                    const cantidad = carrito.tiendaId === tiendaId ? carrito.items[p.id]?.cantidad ?? 0 : 0;
                    return p.nombre ? (
                      <li key={p.id} className={`producto ${cantidad ? "en-canasta" : ""}`}>
                        <Foto src={p.imagen_url} alt={p.nombre} className="producto-foto" />
                        <div className="producto-info">
                          <strong>{p.nombre}</strong>
                          <span className="precio">{pesos(p.precio)}</span>
                        </div>
                        {cantidad === 0 ? (
                          <button className="boton boton-agregar" onClick={() => cambiarCantidad(p, 1, tiendaId)}>
                            Agregar
                          </button>
                        ) : (
                          <div className="contador">
                            <button onClick={() => cambiarCantidad(p, -1, tiendaId)} aria-label={`Quitar ${p.nombre}`}>
                              −
                            </button>
                            <span aria-live="polite">{cantidad}</span>
                            <button onClick={() => cambiarCantidad(p, 1, tiendaId)} aria-label={`Agregar ${p.nombre}`}>
                              +
                            </button>
                          </div>
                        )}
                      </li>
                    ) : (
                      <li key={p.id} className="producto esqueleto" />
                    );
                  })}
                </ul>
              </section>
            )}
          </>
        )}
      </main>

      <footer className="pie">
        <span>Mercado Vecino · Ingeniería Web II · 4 contenedores, 0 contraseñas en el código</span>
        <a href="/img/CREDITOS.txt" target="_blank" rel="noreferrer">
          Fotos: Wikimedia Commons (créditos)
        </a>
      </footer>

      {unidades > 0 && !carritoAbierto && (
        <button className="canasta-flotante" onClick={() => setCarritoAbierto(true)}>
          🧺 {unidades} · {pesos(lineas.reduce((s, l) => s + l.producto.precio * l.cantidad, 0))}
          <span>Ver canasta →</span>
        </button>
      )}

      {carritoAbierto && (
        <Carrito
          lineas={lineas}
          tienda={tiendaCarrito ?? tienda}
          sesion={sesion}
          onCambiar={(producto, delta) => cambiarCantidad(producto, delta, carrito.tiendaId)}
          onVaciar={() => setCarrito({ tiendaId: null, items: {} })}
          onCerrar={() => setCarritoAbierto(false)}
          onPedir={pedir}
          onIngresar={() => setAcceso({ modo: "ingresar", motivo: "Ingresa para terminar tu pedido. Tu canasta te espera." })}
          onVerPedidos={() => {
            setCarritoAbierto(false);
            ir("pedidos");
          }}
        />
      )}

      {acceso && (
        <Acceso
          modo={acceso.modo}
          motivo={acceso.motivo}
          onCerrar={() => setAcceso(null)}
          onSesion={(nueva) => {
            cambiarSesion(nueva);
            setAcceso(null);
          }}
        />
      )}

      <ModoIngeniero abierto={ingeniero} onCerrar={() => setIngeniero(false)} />
    </div>
  );
}
