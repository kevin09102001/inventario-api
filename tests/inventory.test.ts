import { afterAll, describe, expect, it } from "vitest";
import { AppError } from "../src/domain/errors.js";
import { mergeItems } from "../src/services/inventory.js";
import type { InventoryService } from "../src/services/inventory.js";
import { closeRepo, seededService } from "./helpers.js";

afterAll(closeRepo);

async function stockOf(service: InventoryService, store: string, sku: string) {
  const [level] = await service.listStock({ store, sku });
  return level ?? { quantity: 0, reserved: 0, available: 0 };
}

async function expectError(promise: Promise<unknown>, code: string) {
  const err = await promise.catch((e) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  return err as AppError;
}

describe("mergeItems", () => {
  it("suma líneas repetidas del mismo SKU", () => {
    expect(
      mergeItems([
        { sku: "A", quantity: 2 },
        { sku: "B", quantity: 1 },
        { sku: "A", quantity: 3 },
      ]),
    ).toEqual([
      { sku: "A", quantity: 5 },
      { sku: "B", quantity: 1 },
    ]);
  });
});

describe("ajustes", () => {
  it("suma y resta existencia y deja el movimiento", async () => {
    const service = await seededService();
    const after = await service.adjust({ store: "TGU01", sku: "ZAP-001", quantity: -3, reason: "Producto dañado" });
    expect(after).toMatchObject({ quantity: 7, reserved: 0, available: 7 });

    const [last] = await service.listMovements({ store: "TGU01", sku: "ZAP-001", limit: 1 });
    expect(last).toMatchObject({ type: "ADJUSTMENT_OUT", quantity: 3, reason: "Producto dañado" });
  });

  it("no deja la existencia en negativo", async () => {
    const service = await seededService();
    const err = await expectError(
      service.adjust({ store: "TGU01", sku: "ZAP-001", quantity: -11, reason: "Conteo físico" }),
      "INSUFFICIENT_STOCK",
    );
    expect(err.details).toEqual([{ sku: "ZAP-001", requested: 11, available: 10 }]);
    expect((await stockOf(service, "TGU01", "ZAP-001")).quantity).toBe(10);
  });

  it("rechaza tiendas o productos que no existen", async () => {
    const service = await seededService();
    await expectError(service.adjust({ store: "XXX", sku: "ZAP-001", quantity: 1, reason: "Prueba" }), "NOT_FOUND");
    await expectError(service.adjust({ store: "TGU01", sku: "NOPE", quantity: 1, reason: "Prueba" }), "NOT_FOUND");
  });
});

describe("traslados", () => {
  it("mueve la mercadería de una tienda a otra", async () => {
    const service = await seededService();
    const transfer = await service.transfer({
      from: "TGU01",
      to: "SPS01",
      items: [
        { sku: "ZAP-001", quantity: 4 },
        { sku: "CAR-010", quantity: 2 },
      ],
    });

    expect((await stockOf(service, "TGU01", "ZAP-001")).quantity).toBe(6);
    expect((await stockOf(service, "SPS01", "ZAP-001")).quantity).toBe(4);
    expect((await stockOf(service, "SPS01", "CAR-010")).quantity).toBe(2);
    expect(await service.getTransfer(transfer.id)).toMatchObject({ from: "TGU01", to: "SPS01" });

    const movements = await service.listMovements({ sku: "ZAP-001" });
    expect(movements.filter((m) => m.reference === transfer.id).map((m) => m.type).sort()).toEqual([
      "TRANSFER_IN",
      "TRANSFER_OUT",
    ]);
  });

  it("es todo o nada: si una línea no alcanza, no se mueve ninguna", async () => {
    const service = await seededService();
    const err = await expectError(
      service.transfer({
        from: "TGU01",
        to: "SPS01",
        items: [
          { sku: "ZAP-001", quantity: 5 },
          { sku: "CAR-010", quantity: 50 },
        ],
      }),
      "INSUFFICIENT_STOCK",
    );
    expect(err.details).toEqual([{ sku: "CAR-010", requested: 50, available: 10 }]);
    expect((await stockOf(service, "TGU01", "ZAP-001")).quantity).toBe(10);
    expect((await stockOf(service, "SPS01", "ZAP-001")).quantity).toBe(0);
  });

  it("valida el total cuando el mismo SKU viene en varias líneas", async () => {
    const service = await seededService();
    await expectError(
      service.transfer({
        from: "TGU01",
        to: "SPS01",
        items: [
          { sku: "ZAP-001", quantity: 6 },
          { sku: "ZAP-001", quantity: 6 },
        ],
      }),
      "INSUFFICIENT_STOCK",
    );
    expect((await stockOf(service, "TGU01", "ZAP-001")).quantity).toBe(10);
  });

  it("no permite trasladar a la misma tienda", async () => {
    const service = await seededService();
    await expectError(
      service.transfer({ from: "TGU01", to: "TGU01", items: [{ sku: "ZAP-001", quantity: 1 }] }),
      "BAD_REQUEST",
    );
  });
});

describe("reservas de facturas en espera", () => {
  it("lo reservado no se puede vender ni trasladar", async () => {
    const service = await seededService();
    await service.reserve({ store: "TGU01", items: [{ sku: "ZAP-001", quantity: 8 }], reference: "FAC-1" });

    expect(await stockOf(service, "TGU01", "ZAP-001")).toMatchObject({ quantity: 10, reserved: 8, available: 2 });
    await expectError(
      service.transfer({ from: "TGU01", to: "SPS01", items: [{ sku: "ZAP-001", quantity: 3 }] }),
      "INSUFFICIENT_STOCK",
    );
    await expectError(service.reserve({ store: "TGU01", items: [{ sku: "ZAP-001", quantity: 3 }] }), "INSUFFICIENT_STOCK");
  });

  it("confirmar la reserva la convierte en venta", async () => {
    const service = await seededService();
    const r = await service.reserve({ store: "TGU01", items: [{ sku: "ZAP-001", quantity: 3 }] });
    const confirmed = await service.confirmReservation(r.id);

    expect(confirmed.status).toBe("CONFIRMED");
    expect(await stockOf(service, "TGU01", "ZAP-001")).toMatchObject({ quantity: 7, reserved: 0, available: 7 });
    const [sale] = await service.listMovements({ store: "TGU01", sku: "ZAP-001", limit: 1 });
    expect(sale).toMatchObject({ type: "SALE", quantity: 3, reference: r.id });
  });

  it("liberar la reserva devuelve la existencia", async () => {
    const service = await seededService();
    const r = await service.reserve({ store: "TGU01", items: [{ sku: "ZAP-001", quantity: 3 }] });
    await service.releaseReservation(r.id);
    expect(await stockOf(service, "TGU01", "ZAP-001")).toMatchObject({ quantity: 10, reserved: 0, available: 10 });
  });

  it("una reserva cerrada no se puede cerrar otra vez", async () => {
    const service = await seededService();
    const r = await service.reserve({ store: "TGU01", items: [{ sku: "ZAP-001", quantity: 3 }] });
    await service.confirmReservation(r.id);
    await expectError(service.releaseReservation(r.id), "RESERVATION_CLOSED");
    await expectError(service.confirmReservation(r.id), "RESERVATION_CLOSED");
    expect((await stockOf(service, "TGU01", "ZAP-001")).quantity).toBe(7);
  });

  it("si una línea de la reserva no alcanza, no aparta nada", async () => {
    const service = await seededService();
    await expectError(
      service.reserve({
        store: "TGU01",
        items: [
          { sku: "ZAP-001", quantity: 2 },
          { sku: "CAR-010", quantity: 11 },
        ],
      }),
      "INSUFFICIENT_STOCK",
    );
    expect((await stockOf(service, "TGU01", "ZAP-001")).reserved).toBe(0);
  });

  it("con muchas reservas al mismo tiempo nunca se aparta más de lo que hay", async () => {
    const service = await seededService();
    const attempts = Array.from({ length: 25 }, (_, i) =>
      service.reserve({ store: "TGU01", items: [{ sku: "ZAP-001", quantity: 1 }], reference: `FAC-${i}` }),
    );
    const results = await Promise.allSettled(attempts);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    expect(await stockOf(service, "TGU01", "ZAP-001")).toMatchObject({ quantity: 10, reserved: 10, available: 0 });
  });
});

describe("reporte de existencia baja", () => {
  it("lista lo que está en el mínimo o por debajo", async () => {
    const service = await seededService();
    await service.adjust({ store: "TGU01", sku: "CAR-010", quantity: -8, reason: "Venta mayorista" });
    const low = await service.lowStock(5, "TGU01");
    expect(low.map((s) => [s.sku, s.available])).toEqual([["CAR-010", 2]]);
  });
});
