const pesosCo = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

export const pesos = (valor) => pesosCo.format(valor);

const relativo = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

export function haceCuanto(iso) {
  const segundos = Math.round((new Date(iso) - Date.now()) / 1000);
  const pasos = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [30, "day"],
    [12, "month"],
  ];
  let valor = segundos;
  for (const [tamano, unidad] of pasos) {
    if (Math.abs(valor) < tamano) return relativo.format(valor, unidad);
    valor = Math.round(valor / tamano);
  }
  return relativo.format(valor, "year");
}

export const iniciales = (nombre = "") =>
  nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0].toUpperCase())
    .join("");

export const hora = (fecha) =>
  fecha.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
