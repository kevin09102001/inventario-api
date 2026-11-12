import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.js";
import { closeRepo, seededService } from "./helpers.js";

afterAll(closeRepo);

let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  app = createApp(await seededService());
});

describe("API HTTP", () => {
  it("GET /health", async () => {
    await request(app).get("/health").expect(200, { status: "ok" });
  });

  it("crea productos y responde 409 si el SKU ya existe", async () => {
    const product = { sku: "LOC-500", name: "Loción 100 ml", price: 650, cost: 300 };
    await request(app).post("/products").send(product).expect(201);
    const res = await request(app).post("/products").send(product).expect(409);
    expect(res.body.error.code).toBe("PRODUCT_EXISTS");
  });

  it("valida el cuerpo de la petición", async () => {
    const res = await request(app)
      .post("/transfers")
      .send({ from: "TGU01", to: "SPS01", items: [{ sku: "ZAP-001", quantity: -2 }] })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details[0].path).toBe("items.0.quantity");
  });

  it("responde 400 si el JSON viene mal formado", async () => {
    const res = await request(app)
      .post("/stores")
      .set("Content-Type", "application/json")
      .send("{ no es json")
      .expect(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });

  it("traslado completo por HTTP", async () => {
    const created = await request(app)
      .post("/transfers")
      .send({ from: "TGU01", to: "SPS01", items: [{ sku: "ZAP-001", quantity: 4 }], note: "Reposición" })
      .expect(201);

    await request(app).get(`/transfers/${created.body.id}`).expect(200);
    const stock = await request(app).get("/stock").query({ sku: "ZAP-001" }).expect(200);
    expect(stock.body.map((s: { store: string; available: number }) => [s.store, s.available])).toEqual([
      ["SPS01", 4],
      ["TGU01", 6],
    ]);
  });

  it("responde 409 con el detalle cuando no hay existencia", async () => {
    const res = await request(app)
      .post("/transfers")
      .send({ from: "TGU01", to: "SPS01", items: [{ sku: "ZAP-001", quantity: 99 }] })
      .expect(409);
    expect(res.body.error).toMatchObject({
      code: "INSUFFICIENT_STOCK",
      details: [{ sku: "ZAP-001", requested: 99, available: 10 }],
    });
  });

  it("flujo de reserva: crear, confirmar y no permitir confirmar dos veces", async () => {
    const r = await request(app)
      .post("/reservations")
      .send({ store: "TGU01", items: [{ sku: "CAR-010", quantity: 2 }], reference: "FAC-77" })
      .expect(201);
    expect(r.body.status).toBe("ACTIVE");

    const confirmed = await request(app).post(`/reservations/${r.body.id}/confirm`).expect(200);
    expect(confirmed.body.status).toBe("CONFIRMED");
    await request(app).post(`/reservations/${r.body.id}/confirm`).expect(409);
  });

  it("reporte de existencia baja", async () => {
    const res = await request(app).get("/reports/low-stock").query({ threshold: 10 }).expect(200);
    expect(res.body).toHaveLength(2);
  });

  it("404 para recursos y rutas que no existen", async () => {
    await request(app).get("/products/NO-EXISTE").expect(404);
    await request(app).get("/no-existe").expect(404);
  });
});
