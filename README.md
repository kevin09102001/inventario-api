# Inventario API

[![CI](https://github.com/kevin09102001/inventario-api/actions/workflows/ci.yml/badge.svg)](https://github.com/kevin09102001/inventario-api/actions/workflows/ci.yml)

API REST para manejar el inventario de una cadena de tiendas: ajustes, traslados entre tiendas y reservas de existencia para facturas en espera.

La idea sale de un problema real en retail: el punto de venta deja facturar productos sin existencia y las facturas en espera no apartan la mercadería, entonces el inventario termina en negativo. Esta API no permite que eso pase.

## Qué hace

- **Tiendas y productos**: alta y consulta.
- **Existencias por tienda**: cantidad, reservado y disponible (`disponible = cantidad - reservado`).
- **Ajustes**: entradas y salidas manuales con motivo. Una salida nunca deja el disponible en negativo.
- **Traslados**: mueven varias líneas de una tienda a otra. Son todo o nada: si una línea no alcanza, no se mueve ninguna y la respuesta dice qué faltó.
- **Reservas**: una factura en espera aparta la existencia. Al confirmarla se registra la venta; al liberarla la existencia vuelve a estar disponible.
- **Historial de movimientos** y **reporte de existencia baja**.
- Documentación interactiva con Swagger en `/docs`.

## Tecnologías

Node.js 22, TypeScript, Express 5, MongoDB, Zod (validación), Vitest y Supertest (pruebas), Docker y GitHub Actions.

## Correr el proyecto

### Con Docker

```bash
docker compose up --build
```

La API queda en `http://localhost:3000` y la documentación en `http://localhost:3000/docs`.

Para cargar datos de ejemplo (3 tiendas y 6 productos):

```bash
MONGO_URL=mongodb://localhost:27017 npm run seed
```

### Sin Docker

```bash
npm install
npm run dev
```

Si no definís `MONGO_URL`, la API guarda todo en memoria. Sirve para probar rápido, pero los datos se pierden al reiniciar.

## Ejemplos

Crear un traslado:

```bash
curl -X POST http://localhost:3000/transfers \
  -H "Content-Type: application/json" \
  -d '{"from":"TGU01","to":"SPS01","items":[{"sku":"ZAP-001","quantity":4}]}'
```

Si no hay existencia suficiente responde `409`:

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Existencia insuficiente en la tienda 'TGU01'",
    "details": [{ "sku": "ZAP-001", "requested": 99, "available": 10 }]
  }
}
```

Apartar existencia para una factura en espera y luego confirmarla:

```bash
curl -X POST http://localhost:3000/reservations \
  -H "Content-Type: application/json" \
  -d '{"store":"TGU01","items":[{"sku":"CAR-010","quantity":2}],"reference":"FAC-000123"}'

curl -X POST http://localhost:3000/reservations/<id>/confirm
```

## Endpoints

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/health` | Estado del servicio |
| GET, POST | `/stores` | Tiendas |
| GET, POST | `/products` | Productos |
| GET | `/products/:sku` | Un producto |
| GET | `/stock?store=&sku=` | Existencias |
| POST | `/adjustments` | Ajuste manual |
| POST | `/transfers` | Traslado entre tiendas |
| GET | `/transfers/:id` | Ver un traslado |
| POST | `/reservations` | Apartar existencia |
| GET | `/reservations/:id` | Ver una reserva |
| POST | `/reservations/:id/confirm` | Confirmar venta |
| POST | `/reservations/:id/release` | Liberar reserva |
| GET | `/movements?store=&sku=&limit=` | Historial |
| GET | `/reports/low-stock?threshold=&store=` | Existencia baja |

## Pruebas

```bash
npm test
```

Las mismas pruebas corren de dos formas:

- **En memoria**, sin base de datos (lo que corre por defecto).
- **Contra MongoDB real**, si se define `MONGO_URL`. En GitHub Actions corren así con un contenedor de MongoDB.

Una de las pruebas lanza 25 reservas al mismo tiempo sobre 10 unidades y verifica que solo 10 pasen.

## Cómo evita las existencias negativas

Cada descuento es una sola operación en MongoDB que solo se aplica si lo disponible alcanza:

```js
stock.updateOne(
  { store, sku, $expr: { $gte: [{ $subtract: ["$quantity", "$reserved"] }, cantidad] } },
  { $inc: { quantity: -cantidad } }
)
```

Si dos cajas intentan vender la última unidad al mismo tiempo, solo una actualización encuentra el documento y la otra recibe `409`.

Los traslados y reservas de varias líneas no usan transacciones (no requieren un replica set). Si una línea falla, se devuelve lo que ya se había descontado.

## Estructura

```
src/
  domain/        tipos y errores
  repositories/  acceso a datos (MongoDB y memoria)
  services/      reglas de negocio
  http/          rutas Express y validación
tests/           pruebas de servicio y de la API
docs/            especificación OpenAPI
```

## Licencia

MIT
