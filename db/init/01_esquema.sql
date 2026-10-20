-- Esquema y datos semilla de Mercado Vecino.
-- Lo ejecuta la imagen oficial de PostgreSQL SOLO cuando el volumen de datos está vacío.
-- Las tablas quedan a nombre del superusuario (POSTGRES_USER); la API usa otro rol
-- con permisos mínimos que crea 02_rol_app.sh.
--
-- imagen_url guarda el link de la foto. Son rutas del propio sitio (/img/...), servidas por
-- Nginx desde frontend/public/img: funcionan sin internet y no dependen de un servidor ajeno.
-- Las fotos vienen de Wikimedia Commons; autores y licencias en frontend/public/img/CREDITOS.txt

CREATE TABLE tiendas (
    id           SERIAL PRIMARY KEY,
    nombre       TEXT NOT NULL,
    barrio       TEXT NOT NULL,
    categoria    TEXT NOT NULL,
    descripcion  TEXT NOT NULL,
    imagen_url   TEXT NOT NULL CHECK (imagen_url LIKE '/img/%')
);

CREATE TABLE productos (
    id          SERIAL PRIMARY KEY,
    tienda_id   INTEGER NOT NULL REFERENCES tiendas (id),
    nombre      TEXT NOT NULL,
    precio      INTEGER NOT NULL CHECK (precio > 0),  -- pesos colombianos, sin decimales
    imagen_url  TEXT NOT NULL CHECK (imagen_url LIKE '/img/%')
);

-- Cuentas de clientes. La contraseña nunca se guarda: solo su hash scrypt con sal propia
CREATE TABLE usuarios (
    id          SERIAL PRIMARY KEY,
    nombre      TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
    clave_hash  TEXT NOT NULL CHECK (clave_hash LIKE 'scrypt$%'),
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pedidos (
    id          SERIAL PRIMARY KEY,
    usuario_id  INTEGER NOT NULL REFERENCES usuarios (id),
    tienda_id   INTEGER NOT NULL REFERENCES tiendas (id),
    cliente     TEXT NOT NULL,  -- quien recibe (puede ser distinto del titular de la cuenta)
    direccion   TEXT NOT NULL,
    total       INTEGER NOT NULL CHECK (total >= 0),
    estado      TEXT NOT NULL DEFAULT 'recibido',
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pedido_items (
    pedido_id        INTEGER NOT NULL REFERENCES pedidos (id) ON DELETE CASCADE,
    producto_id      INTEGER NOT NULL REFERENCES productos (id),
    cantidad         INTEGER NOT NULL CHECK (cantidad > 0),
    precio_unitario  INTEGER NOT NULL CHECK (precio_unitario > 0),
    PRIMARY KEY (pedido_id, producto_id)
);

CREATE INDEX productos_tienda_idx ON productos (tienda_id);
CREATE INDEX pedidos_usuario_idx ON pedidos (usuario_id, creado_en DESC);

INSERT INTO tiendas (nombre, barrio, categoria, descripcion, imagen_url) VALUES
    ('Tienda Doña Rosa',     'Chapinero',   'Tienda de barrio', 'Lo de la casa, fiado y con sonrisa desde 1987',  '/img/tiendas/tienda.jpg'),
    ('Fruver La Cosecha',    'Teusaquillo', 'Fruver',           'Fruta y verdura que llega cada madrugada de Corabastos', '/img/tiendas/fruver.jpg'),
    ('Panadería El Trigal',  'Suba',        'Panadería',        'Pan caliente a las 6 a. m. y a las 4 p. m.',     '/img/tiendas/panaderia.jpg'),
    ('Droguería San Jorge',  'Kennedy',     'Droguería',        'Lo básico del botiquín, sin hacer fila',          '/img/tiendas/drogueria.jpg'),
    ('Miscelánea El Vecino', 'Usaquén',     'Miscelánea',       'Útiles, pilas y ese bombillo que se fundió',      '/img/tiendas/miscelanea.jpg');

INSERT INTO productos (tienda_id, nombre, precio, imagen_url) VALUES
    (1, 'Arroz Diana 1 kg',            5200, '/img/productos/arroz.jpg'),
    (1, 'Huevos AA x 30',             17900, '/img/productos/huevos.jpg'),
    (1, 'Leche Alquería 1,1 L',        4600, '/img/productos/leche.jpg'),
    (1, 'Café Sello Rojo 250 g',       9800, '/img/productos/cafe.jpg'),
    (2, 'Aguacate Hass (unidad)',      3500, '/img/productos/aguacate.jpg'),
    (2, 'Tomate chonto 1 lb',          2400, '/img/productos/tomate.jpg'),
    (2, 'Papa pastusa 2 kg',           6000, '/img/productos/papa.jpg'),
    (2, 'Lulo 1 lb',                   4200, '/img/productos/lulo.jpg'),
    (3, 'Pan aliñado',                 1500, '/img/productos/pan.jpg'),
    (3, 'Almojábana',                  1800, '/img/productos/almojabana.jpg'),
    (3, 'Pandebono',                   1800, '/img/productos/pandebono.jpg'),
    (3, 'Roscón de arequipe',          3500, '/img/productos/roscon.jpg'),
    (4, 'Acetaminofén 500 mg x 10',    2900, '/img/productos/acetaminofen.jpg'),
    (4, 'Suero oral 500 ml',           6500, '/img/productos/suero.jpg'),
    (4, 'Alcohol antiséptico 350 ml',  7200, '/img/productos/alcohol.jpg'),
    (5, 'Cuaderno cuadriculado 100 h', 6800, '/img/productos/cuaderno.jpg'),
    (5, 'Pilas AA x 4',               11500, '/img/productos/pilas.jpg'),
    (5, 'Bombillo LED 9 W',            8900, '/img/productos/bombillo.jpg');
