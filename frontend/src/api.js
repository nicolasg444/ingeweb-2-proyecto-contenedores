// VITE_API_URL se incrusta en el JavaScript público al compilar: solo URLs, nunca secretos
const BASE = import.meta.env.VITE_API_URL || "/api";
const CLAVE_SESION = "mercado-vecino.sesion";

// ---------------------------------------------------------------- sesión
// sessionStorage y no localStorage: la sesión muere al cerrar la pestaña. El token es lo
// único que se guarda; la contraseña nunca sale del formulario salvo hacia la API
export function leerSesion() {
  try {
    return JSON.parse(sessionStorage.getItem(CLAVE_SESION));
  } catch {
    return null;
  }
}

export function guardarSesion(sesion) {
  try {
    if (sesion) sessionStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
    else sessionStorage.removeItem(CLAVE_SESION);
  } catch {
    /* almacenamiento bloqueado: la sesión vive solo en memoria */
  }
}

// ---------------------------------------------------------------- trazas
// Cada petición se publica aquí; el Modo ingeniero se suscribe para dibujarlas
const oyentes = new Set();
let secuencia = 0;

export function suscribirTrazas(oyente) {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

// Qué contenedores tocó la petición, deducido de lo que respondió la API
function recorrido(ruta, estado, cache) {
  if (estado === 0 || estado === 502 || estado === 504) return ["web"];
  if (cache === "HIT") return ["web", "api", "redis"];
  if (cache === "MISS") return ["web", "api", "db", "redis"];
  if (ruta === "/sistema") return ["web", "api", "db", "redis"];
  if (ruta === "/health" || [401, 422, 429].includes(estado)) return ["web", "api"];
  if (ruta.startsWith("/auth/login")) return ["web", "api", "redis", "db"];
  return ["web", "api", "db"];
}

function publicar(traza) {
  oyentes.forEach((oyente) => oyente(traza));
}

// ---------------------------------------------------------------- peticiones
export class ErrorApi extends Error {
  constructor(mensaje, estado) {
    super(mensaje);
    this.estado = estado;
  }
}

async function pedir(ruta, { metodo = "GET", cuerpo, token, sondeo = false } = {}) {
  const inicio = performance.now();
  const encabezados = {};
  if (cuerpo) encabezados["Content-Type"] = "application/json";
  if (token) encabezados.Authorization = `Bearer ${token}`;

  let respuesta;
  try {
    respuesta = await fetch(`${BASE}${ruta}`, {
      method: metodo,
      headers: encabezados,
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    publicar({ id: ++secuencia, hora: new Date(), metodo, ruta, estado: 0, ms: performance.now() - inicio, sondeo, nodos: ["web"] });
    throw new ErrorApi("No hay conexión con el servidor", 0);
  }

  const datos = await respuesta.json().catch(() => null);
  const cache = respuesta.headers.get("X-Cache");
  const servidor = /dur=([\d.]+)/.exec(respuesta.headers.get("Server-Timing") || "");
  publicar({
    id: ++secuencia,
    hora: new Date(),
    metodo,
    ruta,
    estado: respuesta.status,
    ms: performance.now() - inicio,
    msApi: servidor ? Number(servidor[1]) : null,
    cache,
    contenedor: respuesta.headers.get("X-Atendido-Por"),
    sondeo,
    nodos: recorrido(ruta, respuesta.status, cache),
  });

  if (!respuesta.ok) {
    const detalle = typeof datos?.detail === "string" ? datos.detail : `Error ${respuesta.status}`;
    throw new ErrorApi(detalle, respuesta.status);
  }
  return { datos, cache };
}

export const obtenerTiendas = () => pedir("/tiendas");
export const obtenerProductos = (tiendaId) => pedir(`/tiendas/${tiendaId}/productos`);
export const obtenerSistema = () => pedir("/sistema", { sondeo: true });

export const registrarse = (cuenta) => pedir("/auth/registro", { metodo: "POST", cuerpo: cuenta });
export const iniciarSesion = (credenciales) => pedir("/auth/login", { metodo: "POST", cuerpo: credenciales });
export const quienSoy = (token) => pedir("/auth/yo", { token });

export const crearPedido = (pedido, token) => pedir("/pedidos", { metodo: "POST", cuerpo: pedido, token });
export const obtenerMisPedidos = (token) => pedir("/mis-pedidos", { token });
