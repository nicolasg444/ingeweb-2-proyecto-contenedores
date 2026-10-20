import { useEffect, useState } from "react";
import { pesos } from "../formato.js";
import Foto from "./Foto.jsx";

export default function Carrito({ lineas, tienda, sesion, onCambiar, onVaciar, onCerrar, onPedir, onIngresar, onVerPedidos }) {
  const [cliente, setCliente] = useState(sesion?.usuario.nombre ?? "");
  const [direccion, setDireccion] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [confirmado, setConfirmado] = useState(null);

  useEffect(() => {
    if (sesion && !cliente) setCliente(sesion.usuario.nombre);
  }, [sesion, cliente]);

  useEffect(() => {
    const alPresionar = (e) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", alPresionar);
    return () => window.removeEventListener("keydown", alPresionar);
  }, [onCerrar]);

  const total = lineas.reduce((suma, l) => suma + l.producto.precio * l.cantidad, 0);
  const unidades = lineas.reduce((suma, l) => suma + l.cantidad, 0);

  async function enviar(e) {
    e.preventDefault();
    setEnviando(true);
    setError("");
    try {
      setConfirmado(await onPedir({ cliente, direccion }));
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="velo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <aside className="cajon" role="dialog" aria-modal="true" aria-labelledby="carrito-titulo">
        <header className="cajon-cabecera">
          <h2 id="carrito-titulo">Tu canasta</h2>
          <button className="cerrar" onClick={onCerrar} aria-label="Cerrar carrito">
            ×
          </button>
        </header>

        {confirmado ? (
          <div className="confirmado">
            <div className="sello" aria-hidden="true">
              ✓
            </div>
            <h3>¡Pedido #{confirmado.id} recibido!</h3>
            <p>
              {tienda?.nombre} ya lo está alistando. Total {pesos(confirmado.total)}.
            </p>
            <button className="boton boton-primario ancho" onClick={onVerPedidos}>
              Ver mis pedidos
            </button>
            <button className="boton boton-texto ancho" onClick={onCerrar}>
              Seguir comprando
            </button>
          </div>
        ) : lineas.length === 0 ? (
          <div className="vacio">
            <div className="vacio-icono" aria-hidden="true">
              🧺
            </div>
            <p>Tu canasta está vacía.</p>
            <p className="suave">Elige una tienda y agrega lo que necesites.</p>
          </div>
        ) : (
          <>
            <p className="cajon-tienda">
              De <strong>{tienda?.nombre}</strong> · {unidades} {unidades === 1 ? "producto" : "productos"}
              <button className="boton-texto" onClick={onVaciar}>
                Vaciar
              </button>
            </p>
            <ul className="lineas">
              {lineas.map(({ producto, cantidad }) => (
                <li key={producto.id}>
                  <Foto src={producto.imagen_url} alt={producto.nombre} className="linea-foto" />
                  <div className="linea-info">
                    <strong>{producto.nombre}</strong>
                    <span>{pesos(producto.precio * cantidad)}</span>
                  </div>
                  <div className="contador contador-chico">
                    <button onClick={() => onCambiar(producto, -1)} aria-label={`Quitar ${producto.nombre}`}>
                      −
                    </button>
                    <span>{cantidad}</span>
                    <button onClick={() => onCambiar(producto, 1)} aria-label={`Agregar ${producto.nombre}`}>
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="cajon-pie">
              <p className="total">
                <span>Total</span>
                <strong>{pesos(total)}</strong>
              </p>
              {sesion ? (
                <form onSubmit={enviar}>
                  <label>
                    Quién recibe
                    <input value={cliente} onChange={(e) => setCliente(e.target.value)} required maxLength={120} />
                  </label>
                  <label>
                    Dirección
                    <input
                      value={direccion}
                      onChange={(e) => setDireccion(e.target.value)}
                      required
                      maxLength={200}
                      placeholder="Cra 7 # 45-10, apto 301"
                      autoComplete="street-address"
                    />
                  </label>
                  {error && <p className="error">{error}</p>}
                  <button className="boton boton-primario ancho" disabled={enviando}>
                    {enviando ? "Enviando…" : `Pedir por ${pesos(total)}`}
                  </button>
                </form>
              ) : (
                <>
                  <p className="suave">Para hacer el pedido necesitas una cuenta. Tu canasta se conserva.</p>
                  <button className="boton boton-primario ancho" onClick={onIngresar}>
                    Ingresar para pedir
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
