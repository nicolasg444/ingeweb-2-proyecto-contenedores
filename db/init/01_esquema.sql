-- Esquema y datos semilla de Mercado Vecino.
-- Lo ejecuta la imagen oficial de PostgreSQL SOLO cuando el volumen de datos está vacío.
-- Las tablas quedan a nombre del superusuario (POSTGRES_USER); la API usa otro rol
-- con permisos mínimos que crea 02_rol_app.sh.

CREATE TABLE tiendas (
    id      SERIAL PRIMARY KEY,
    nombre  TEXT NOT NULL,
    barrio  TEXT NOT NULL
);

CREATE TABLE productos (
    id         SERIAL PRIMARY KEY,
    tienda_id  INTEGER NOT NULL REFERENCES tiendas (id),
    nombre     TEXT NOT NULL,
    precio     INTEGER NOT NULL CHECK (precio > 0)  -- pesos colombianos, sin decimales
);

CREATE TABLE pedidos (
    id         SERIAL PRIMARY KEY,
    tienda_id  INTEGER NOT NULL REFERENCES tiendas (id),
    cliente    TEXT NOT NULL,
    direccion  TEXT NOT NULL,
    total      INTEGER NOT NULL CHECK (total >= 0),
    estado     TEXT NOT NULL DEFAULT 'recibido',
    creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pedido_items (
    pedido_id        INTEGER NOT NULL REFERENCES pedidos (id) ON DELETE CASCADE,
    producto_id      INTEGER NOT NULL REFERENCES productos (id),
    cantidad         INTEGER NOT NULL CHECK (cantidad > 0),
    precio_unitario  INTEGER NOT NULL CHECK (precio_unitario > 0),
    PRIMARY KEY (pedido_id, producto_id)
);

CREATE INDEX productos_tienda_idx ON productos (tienda_id);

INSERT INTO tiendas (nombre, barrio) VALUES
    ('Tienda Doña Rosa',       'Chapinero'),
    ('Fruver La Cosecha',      'Teusaquillo'),
    ('Panadería El Trigal',    'Suba'),
    ('Droguería San Jorge',    'Kennedy'),
    ('Miscelánea El Vecino',   'Usaquén');

INSERT INTO productos (tienda_id, nombre, precio) VALUES
    (1, 'Arroz Diana 1 kg',            5200),
    (1, 'Huevos AA x 30',             17900),
    (1, 'Leche Alquería 1,1 L',        4600),
    (1, 'Café Sello Rojo 250 g',       9800),
    (2, 'Aguacate Hass (unidad)',      3500),
    (2, 'Tomate chonto 1 lb',          2400),
    (2, 'Papa pastusa 2 kg',           6000),
    (2, 'Lulo 1 lb',                   4200),
    (3, 'Pan aliñado',                 1500),
    (3, 'Almojábana',                  1800),
    (3, 'Pandebono',                   1800),
    (3, 'Roscón de arequipe',          3500),
    (4, 'Acetaminofén 500 mg x 10',    2900),
    (4, 'Suero oral 500 ml',           6500),
    (4, 'Alcohol antiséptico 350 ml',  7200),
    (5, 'Cuaderno cuadriculado 100 h', 6800),
    (5, 'Pilas AA x 4',               11500),
    (5, 'Bombillo LED 9 W',            8900);
