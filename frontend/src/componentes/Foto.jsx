import { useState } from "react";

// La URL de la foto viene de la base de datos (columna imagen_url). Si el archivo no carga,
// se muestra la inicial del producto en lugar de un ícono roto
export default function Foto({ src, alt, className = "" }) {
  const [fallo, setFallo] = useState(false);

  if (!src || fallo) {
    return (
      <div className={`foto foto-vacia ${className}`} role="img" aria-label={alt}>
        <span>{alt?.[0] ?? "?"}</span>
      </div>
    );
  }
  return (
    <img
      className={`foto ${className}`}
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFallo(true)}
    />
  );
}
