import { useEffect, useRef, useState } from "react";
import { iniciarSesion, registrarse } from "../api.js";

// Fortaleza orientativa: longitud y variedad. La regla dura (mínimo 8) la aplica la API
function fortaleza(clave) {
  let puntos = 0;
  if (clave.length >= 8) puntos++;
  if (clave.length >= 12) puntos++;
  if (/[a-z]/.test(clave) && /[A-Z]/.test(clave)) puntos++;
  if (/\d/.test(clave)) puntos++;
  if (/[^A-Za-z0-9]/.test(clave)) puntos++;
  return Math.min(puntos, 4);
}
const NIVELES = ["Muy débil", "Débil", "Aceptable", "Buena", "Excelente"];

export default function Acceso({ modo: modoInicial, motivo, onCerrar, onSesion }) {
  const [modo, setModo] = useState(modoInicial);
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const primerCampo = useRef(null);

  useEffect(() => {
    primerCampo.current?.focus();
    const alPresionar = (e) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", alPresionar);
    return () => window.removeEventListener("keydown", alPresionar);
  }, [modo, onCerrar]);

  async function enviar(e) {
    e.preventDefault();
    setEnviando(true);
    setError("");
    try {
      const { datos } =
        modo === "registro" ? await registrarse({ nombre, email, clave }) : await iniciarSesion({ email, clave });
      onSesion(datos);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  const nivel = fortaleza(clave);

  return (
    <div className="velo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <section className="modal acceso" role="dialog" aria-modal="true" aria-labelledby="acceso-titulo">
        <button className="cerrar" onClick={onCerrar} aria-label="Cerrar">
          ×
        </button>
        <div className="toldo toldo-mini" aria-hidden="true" />
        <h2 id="acceso-titulo">{modo === "registro" ? "Crea tu cuenta" : "Hola de nuevo, vecino"}</h2>
        {motivo && <p className="acceso-motivo">{motivo}</p>}

        <div className="pestanas" role="tablist">
          <button role="tab" aria-selected={modo === "ingresar"} onClick={() => setModo("ingresar")}>
            Ingresar
          </button>
          <button role="tab" aria-selected={modo === "registro"} onClick={() => setModo("registro")}>
            Crear cuenta
          </button>
        </div>

        <form onSubmit={enviar}>
          {modo === "registro" && (
            <label>
              Nombre
              <input
                ref={primerCampo}
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                required
                minLength={2}
                maxLength={80}
                autoComplete="name"
              />
            </label>
          )}
          <label>
            Correo
            <input
              ref={modo === "ingresar" ? primerCampo : undefined}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={120}
              autoComplete="email"
            />
          </label>
          <label>
            Contraseña
            <span className="campo-clave">
              <input
                type={verClave ? "text" : "password"}
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                required
                minLength={modo === "registro" ? 8 : 1}
                maxLength={128}
                autoComplete={modo === "registro" ? "new-password" : "current-password"}
              />
              <button type="button" onClick={() => setVerClave((v) => !v)} aria-label={verClave ? "Ocultar" : "Mostrar"}>
                {verClave ? "Ocultar" : "Ver"}
              </button>
            </span>
          </label>
          {modo === "registro" && clave && (
            <div className={`fortaleza nivel-${nivel}`} aria-live="polite">
              <span className="fortaleza-barra">
                <i />
              </span>
              {NIVELES[nivel]}
            </div>
          )}

          {error && <p className="error">{error}</p>}

          <button className="boton boton-primario ancho" disabled={enviando}>
            {enviando ? "Un momento…" : modo === "registro" ? "Crear cuenta" : "Ingresar"}
          </button>
        </form>

        <p className="nota-seguridad">
          Tu contraseña viaja solo a la API, que guarda un hash <code>scrypt</code> con sal. Nadie, ni nosotros, puede
          leerla.
        </p>
      </section>
    </div>
  );
}
