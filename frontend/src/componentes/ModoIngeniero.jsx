import { useEffect, useMemo, useState } from "react";
import { obtenerSistema, suscribirTrazas } from "../api.js";
import { hora } from "../formato.js";

const MAX_TRAZAS = 200;

// Posiciones del diagrama (viewBox 0 0 560 230). Reproduce la arquitectura del compose.yaml:
// dos redes, y la API como único servicio que está en ambas
const NODOS = {
  nav: { x: 8, y: 95, w: 96, titulo: "Navegador", sub: "tú" },
  web: { x: 134, y: 95, w: 112, titulo: "web · Nginx", sub: "puerto 8080" },
  api: { x: 284, y: 95, w: 124, titulo: "api · FastAPI", sub: "usuario app" },
  redis: { x: 446, y: 28, w: 108, titulo: "redis", sub: "caché" },
  db: { x: 446, y: 162, w: 108, titulo: "db · PostgreSQL", sub: "volumen pgdata" },
};
const ALTO = 44;
const ARISTAS = [
  ["nav", "web", "M104 117 H134"],
  ["web", "api", "M246 117 H284"],
  ["api", "redis", "M408 106 C428 106 426 50 446 50"],
  ["api", "db", "M408 128 C428 128 426 184 446 184"],
];

function origen(traza) {
  if (traza.cache === "HIT") return { texto: "Redis", clase: "o-redis" };
  if (traza.cache === "MISS") return { texto: "PostgreSQL → Redis", clase: "o-db" };
  if (traza.estado === 0) return { texto: "sin red", clase: "o-error" };
  if (traza.nodos.includes("db")) return { texto: "PostgreSQL", clase: "o-db" };
  return { texto: "API", clase: "o-api" };
}

function mediana(valores) {
  if (!valores.length) return null;
  const orden = [...valores].sort((a, b) => a - b);
  return orden[Math.floor(orden.length / 2)];
}

function Diagrama({ ultima, sistema }) {
  const activos = new Set(ultima ? ["nav", ...ultima.nodos] : []);
  const subtitulo = {
    api: ultima?.contenedor ? `contenedor ${ultima.contenedor.slice(0, 12)}` : NODOS.api.sub,
    db: sistema?.db?.ok ? `v${sistema.db.version} · ${sistema.db.ms} ms` : NODOS.db.sub,
    redis: sistema?.redis?.ok ? `${sistema.redis.ms} ms · ${sistema.redis.claves} claves` : NODOS.redis.sub,
  };
  const salud = { db: sistema?.db?.ok, redis: sistema?.redis?.ok, api: sistema ? true : undefined };

  return (
    <svg className="diagrama" viewBox="0 0 560 230" role="img" aria-label="Recorrido de la última petición">
      <rect className="red red-frontend" x="124" y="80" width="294" height="74" rx="10" />
      <text className="red-etiqueta" x="132" y="74">
        red frontend
      </text>
      <rect className="red red-backend" x="274" y="14" width="284" height="210" rx="10" />
      <text className="red-etiqueta red-etiqueta-backend" x="282" y="10">
        red backend · internal: true
      </text>

      <g key={ultima?.id}>
        {ARISTAS.map(([a, b, d]) => (
          <path key={a + b} d={d} className={`arista ${activos.has(a) && activos.has(b) ? "activa" : ""}`} />
        ))}
      </g>

      {Object.entries(NODOS).map(([id, n]) => (
        <g key={id} className={`nodo ${activos.has(id) ? "activo" : ""}`}>
          <rect x={n.x} y={n.y} width={n.w} height={ALTO} rx="8" />
          {salud[id] !== undefined && (
            <circle cx={n.x + n.w - 9} cy={n.y + 9} r="3.5" className={salud[id] ? "vivo" : "caido"} />
          )}
          <text x={n.x + 10} y={n.y + 19} className="nodo-titulo">
            {n.titulo}
          </text>
          <text x={n.x + 10} y={n.y + 34} className="nodo-sub">
            {subtitulo[id] ?? n.sub}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function ModoIngeniero({ abierto, onCerrar }) {
  const [trazas, setTrazas] = useState([]);
  const [sistema, setSistema] = useState(null);
  const [verSondeos, setVerSondeos] = useState(false);

  // Siempre suscrito (aunque el panel esté cerrado) para no perder las primeras peticiones
  useEffect(
    () => suscribirTrazas((t) => setTrazas((actuales) => [t, ...actuales].slice(0, MAX_TRAZAS))),
    [],
  );

  // Sondeo del estado de los contenedores solo mientras el panel está abierto
  useEffect(() => {
    if (!abierto) return undefined;
    let vigente = true;
    const sondear = () =>
      obtenerSistema()
        .then(({ datos }) => vigente && setSistema(datos))
        .catch(() => vigente && setSistema((s) => (s ? { ...s, db: { ok: false }, redis: { ok: false } } : s)));
    sondear();
    const intervalo = setInterval(sondear, 5000);
    return () => {
      vigente = false;
      clearInterval(intervalo);
    };
  }, [abierto]);

  const reales = useMemo(() => trazas.filter((t) => !t.sondeo), [trazas]);
  const visibles = verSondeos ? trazas : reales;
  const ultima = reales[0];

  const conCache = reales.filter((t) => t.cache);
  const aciertos = conCache.length ? Math.round((conCache.filter((t) => t.cache === "HIT").length / conCache.length) * 100) : null;
  const latencia = mediana(reales.map((t) => t.ms));
  const contenedores = new Set(trazas.map((t) => t.contenedor).filter(Boolean));

  return (
    <section className={`ingeniero ${abierto ? "abierto" : ""}`} aria-label="Modo ingeniero" aria-hidden={!abierto}>
      <header className="ing-cabecera">
        <h2>
          <span className="pulso" aria-hidden="true" /> Modo ingeniero
        </h2>
        <dl className="ing-metricas">
          <div>
            <dt>peticiones</dt>
            <dd>{reales.length}</dd>
          </div>
          <div>
            <dt>aciertos caché</dt>
            <dd>{aciertos === null ? "—" : `${aciertos}%`}</dd>
          </div>
          <div>
            <dt>latencia p50</dt>
            <dd>{latencia === null ? "—" : `${latencia.toFixed(0)} ms`}</dd>
          </div>
          <div>
            <dt>contenedores api</dt>
            <dd>{contenedores.size || "—"}</dd>
          </div>
        </dl>
        <div className="ing-acciones">
          <label className="interruptor">
            <input type="checkbox" checked={verSondeos} onChange={(e) => setVerSondeos(e.target.checked)} />
            sondeos
          </label>
          <button onClick={() => setTrazas([])}>limpiar</button>
          <button onClick={onCerrar} aria-label="Cerrar modo ingeniero">
            ×
          </button>
        </div>
      </header>

      <div className="ing-cuerpo">
        <div className="ing-diagrama">
          <Diagrama ultima={ultima} sistema={sistema} />
          {ultima ? (
            <p className="ing-explica">
              Última: <code>{ultima.metodo} /api{ultima.ruta}</code> → {ultima.estado} en {ultima.ms.toFixed(0)} ms
              {ultima.msApi != null && <> (API {ultima.msApi} ms)</>} · servida desde{" "}
              <b className={origen(ultima).clase}>{origen(ultima).texto}</b>
            </p>
          ) : (
            <p className="ing-explica">Navega por la tienda y mira cómo viaja cada petición.</p>
          )}
        </div>

        <div className="ing-registro">
          <table>
            <thead>
              <tr>
                <th>hora</th>
                <th>método</th>
                <th>ruta</th>
                <th>estado</th>
                <th>total</th>
                <th>api</th>
                <th>origen</th>
                <th>contenedor</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((t) => {
                const o = origen(t);
                return (
                  <tr key={t.id} className={t.sondeo ? "sondeo" : ""}>
                    <td>{hora(t.hora)}</td>
                    <td className={`m-${t.metodo.toLowerCase()}`}>{t.metodo}</td>
                    <td className="ruta">/api{t.ruta}</td>
                    <td className={t.estado >= 400 || t.estado === 0 ? "e-mal" : "e-bien"}>{t.estado || "—"}</td>
                    <td>{t.ms.toFixed(0)} ms</td>
                    <td>{t.msApi == null ? "—" : `${t.msApi} ms`}</td>
                    <td>
                      <span className={`origen ${o.clase}`}>{o.texto}</span>
                    </td>
                    <td className="contenedor">{t.contenedor?.slice(0, 12) ?? "—"}</td>
                  </tr>
                );
              })}
              {visibles.length === 0 && (
                <tr>
                  <td colSpan={8} className="ing-vacio">
                    Sin peticiones todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <footer className="ing-pie">
        <span>
          Prueba: <code>docker compose up -d --scale api=3</code> y mira cambiar
          la columna contenedor.
        </span>
        <span>
          <code>docker compose stop redis</code>: la tienda sigue funcionando desde PostgreSQL.
        </span>
      </footer>
    </section>
  );
}
