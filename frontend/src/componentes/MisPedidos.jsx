import { useEffect, useState } from "react";
import { obtenerMisPedidos } from "../api.js";
import { haceCuanto, pesos } from "../formato.js";
import Foto from "./Foto.jsx";

function Pedido({ pedido }) {
  const [abierto, setAbierto] = useState(false);
  const unidades = pedido.items.reduce((suma, i) => suma + i.cantidad, 0);

  return (
    <li className="pedido">
      <button className="pedido-resumen" onClick={() => setAbierto((a) => !a)} aria-expanded={abierto}>
        <div className="pedido-fotos" aria-hidden="true">
          {pedido.items.slice(0, 4).map((item) => (
            <span key={item.producto} className="pedido-foto">
              <Foto src={item.imagen_url} alt={item.producto} />
              {item.cantidad > 1 && <b>×{item.cantidad}</b>}
            </span>
          ))}
          {pedido.items.length > 4 && <span className="pedido-mas">+{pedido.items.length - 4}</span>}
        </div>
        <div className="pedido-datos">
          <strong>
            #{pedido.id} · {pedido.tienda}
          </strong>
          <span className="suave" title={new Date(pedido.creado_en).toLocaleString("es-CO")}>
            {haceCuanto(pedido.creado_en)} · {unidades} {unidades === 1 ? "producto" : "productos"}
          </span>
        </div>
        <span className={`estado estado-${pedido.estado}`}>{pedido.estado}</span>
        <strong className="pedido-total">{pesos(pedido.total)}</strong>
        <span className={`chevron ${abierto ? "abierto" : ""}`} aria-hidden="true">
          ›
        </span>
      </button>

      {abierto && (
        <div className="pedido-detalle">
          <p className="suave">
            Para <strong>{pedido.cliente}</strong> · {pedido.direccion}
          </p>
          <ul>
            {pedido.items.map((item) => (
              <li key={item.producto}>
                <Foto src={item.imagen_url} alt={item.producto} className="linea-foto" />
                <span>
                  {item.cantidad} × {item.producto}
                </span>
                <span>{pesos(item.cantidad * item.precio_unitario)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

export default function MisPedidos({ sesion, onSesionVencida, onIrCatalogo }) {
  const [pedidos, setPedidos] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let vigente = true;
    obtenerMisPedidos(sesion.token)
      .then(({ datos }) => vigente && setPedidos(datos))
      .catch((err) => {
        if (!vigente) return;
        if (err.estado === 401) onSesionVencida(err.message);
        else setError(err.message);
      });
    return () => {
      vigente = false;
    };
  }, [sesion.token, onSesionVencida]);

  const gastado = pedidos?.reduce((suma, p) => suma + p.total, 0) ?? 0;

  return (
    <section className="mis-pedidos">
      <header className="seccion-cabecera">
        <div>
          <p className="antetitulo">Tu historial</p>
          <h1>Mis pedidos</h1>
        </div>
        {pedidos?.length > 0 && (
          <dl className="resumen-gasto">
            <div>
              <dt>Pedidos</dt>
              <dd>{pedidos.length}</dd>
            </div>
            <div>
              <dt>Total en el barrio</dt>
              <dd>{pesos(gastado)}</dd>
            </div>
          </dl>
        )}
      </header>

      {error && <p className="error">{error}</p>}
      {pedidos === null && !error && <div className="esqueleto-lista" aria-label="Cargando" />}
      {pedidos?.length === 0 && (
        <div className="vacio vacio-grande">
          <div className="vacio-icono" aria-hidden="true">
            📦
          </div>
          <p>Todavía no has pedido nada.</p>
          <button className="boton boton-primario" onClick={onIrCatalogo}>
            Ir a las tiendas
          </button>
        </div>
      )}
      {pedidos?.length > 0 && (
        <ul className="pedidos">
          {pedidos.map((p) => (
            <Pedido key={p.id} pedido={p} />
          ))}
        </ul>
      )}
    </section>
  );
}
