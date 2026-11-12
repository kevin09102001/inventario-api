import { randomUUID } from "node:crypto";
import { AppError, badRequest, conflict, notFound } from "../domain/errors.js";
import type { LineItem, Movement, MovementType, Reservation, StockLevel, Transfer } from "../domain/types.js";
import type { InventoryRepository, MovementFilter } from "../repositories/repository.js";

export interface StockView extends StockLevel {
  available: number;
}

interface Shortage {
  sku: string;
  requested: number;
  available: number;
}

const withAvailable = (s: StockLevel): StockView => ({ ...s, available: s.quantity - s.reserved });

/** Junta líneas repetidas del mismo SKU para validar contra el total pedido. */
export function mergeItems(items: LineItem[]): LineItem[] {
  const totals = new Map<string, number>();
  for (const { sku, quantity } of items) totals.set(sku, (totals.get(sku) ?? 0) + quantity);
  return [...totals].map(([sku, quantity]) => ({ sku, quantity }));
}

export class InventoryService {
  private lastTime = 0;

  constructor(
    private repo: InventoryRepository,
    private now: () => Date = () => new Date(),
    private newId: () => string = randomUUID,
  ) {}

  /** Hora siempre creciente, para que el historial quede en orden aunque dos movimientos caigan en el mismo milisegundo. */
  private timestamp(): Date {
    const t = Math.max(this.now().getTime(), this.lastTime + 1);
    this.lastTime = t;
    return new Date(t);
  }

  // ---------- Catálogo ----------

  async createStore(input: { code: string; name: string }) {
    const store = { ...input, createdAt: this.timestamp() };
    if (!(await this.repo.createStore(store))) {
      throw conflict("STORE_EXISTS", `La tienda '${input.code}' ya existe`);
    }
    return store;
  }

  listStores() {
    return this.repo.listStores();
  }

  async createProduct(input: { sku: string; name: string; price: number; cost: number }) {
    const product = { ...input, createdAt: this.timestamp() };
    if (!(await this.repo.createProduct(product))) {
      throw conflict("PRODUCT_EXISTS", `El producto '${input.sku}' ya existe`);
    }
    return product;
  }

  listProducts() {
    return this.repo.listProducts();
  }

  async getProduct(sku: string) {
    const product = await this.repo.getProduct(sku);
    if (!product) throw notFound("Producto", sku);
    return product;
  }

  // ---------- Existencias ----------

  async listStock(filter: { store?: string; sku?: string }) {
    return (await this.repo.listStock(filter)).map(withAvailable);
  }

  /** Productos con existencia disponible igual o menor al mínimo indicado. */
  async lowStock(threshold: number, store?: string) {
    const levels = await this.listStock({ store });
    return levels.filter((s) => s.available <= threshold).sort((a, b) => a.available - b.available);
  }

  listMovements(filter: MovementFilter) {
    return this.repo.listMovements(filter);
  }

  /** Ajuste manual: positivo suma, negativo resta (sin dejar la existencia en negativo). */
  async adjust(input: { store: string; sku: string; quantity: number; reason: string }) {
    const { store, sku, quantity, reason } = input;
    if (quantity === 0) throw badRequest("La cantidad del ajuste no puede ser cero");
    await this.requireStore(store);
    await this.requireProducts([sku]);

    if (quantity > 0) {
      await this.repo.increment(store, sku, quantity);
    } else if (!(await this.repo.tryDecrement(store, sku, -quantity))) {
      throw await this.shortageError(store, [{ sku, quantity: -quantity }]);
    }

    const movement = this.movement(quantity > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", store, sku, Math.abs(quantity), {
      reason,
    });
    await this.repo.addMovements([movement]);
    return withAvailable((await this.repo.getStock(store, sku))!);
  }

  // ---------- Traslados ----------

  /**
   * Traslado entre tiendas. Es todo o nada: si una línea no tiene existencia
   * suficiente, se devuelve lo que ya se había descontado y no se mueve nada.
   */
  async transfer(input: { from: string; to: string; items: LineItem[]; note?: string }): Promise<Transfer> {
    const { from, to, note } = input;
    if (from === to) throw badRequest("La tienda de origen y destino no pueden ser la misma");
    const items = mergeItems(input.items);
    await Promise.all([this.requireStore(from), this.requireStore(to)]);
    await this.requireProducts(items.map((i) => i.sku));

    await this.takeAll(from, items, (s, sku, q) => this.repo.tryDecrement(s, sku, q), (s, sku, q) =>
      this.repo.increment(s, sku, q),
    );
    for (const { sku, quantity } of items) await this.repo.increment(to, sku, quantity);

    const transfer: Transfer = { id: this.newId(), from, to, items, note, createdAt: this.timestamp() };
    await this.repo.addTransfer(transfer);
    await this.repo.addMovements(
      items.flatMap(({ sku, quantity }) => [
        this.movement("TRANSFER_OUT", from, sku, quantity, { reference: transfer.id }),
        this.movement("TRANSFER_IN", to, sku, quantity, { reference: transfer.id }),
      ]),
    );
    return transfer;
  }

  async getTransfer(id: string) {
    const transfer = await this.repo.getTransfer(id);
    if (!transfer) throw notFound("Traslado", id);
    return transfer;
  }

  // ---------- Reservas (facturas en espera) ----------

  /** Aparta existencia para una factura en espera para que nadie más la venda. */
  async reserve(input: { store: string; items: LineItem[]; reference?: string }): Promise<Reservation> {
    const items = mergeItems(input.items);
    await this.requireStore(input.store);
    await this.requireProducts(items.map((i) => i.sku));

    await this.takeAll(input.store, items, (s, sku, q) => this.repo.tryReserve(s, sku, q), (s, sku, q) =>
      this.repo.release(s, sku, q),
    );

    const reservation: Reservation = {
      id: this.newId(),
      store: input.store,
      items,
      status: "ACTIVE",
      reference: input.reference,
      createdAt: this.timestamp(),
    };
    await this.repo.addReservation(reservation);
    return reservation;
  }

  async getReservation(id: string) {
    const reservation = await this.repo.getReservation(id);
    if (!reservation) throw notFound("Reserva", id);
    return reservation;
  }

  /** La factura se cobró: lo apartado sale del inventario como venta. */
  async confirmReservation(id: string) {
    const reservation = await this.closeOrFail(id, "CONFIRMED");
    for (const { sku, quantity } of reservation.items) {
      await this.repo.consumeReserved(reservation.store, sku, quantity);
    }
    await this.repo.addMovements(
      reservation.items.map(({ sku, quantity }) =>
        this.movement("SALE", reservation.store, sku, quantity, { reference: reservation.id }),
      ),
    );
    return this.getReservation(id);
  }

  /** La factura se anuló: lo apartado vuelve a estar disponible. */
  async releaseReservation(id: string) {
    const reservation = await this.closeOrFail(id, "RELEASED");
    for (const { sku, quantity } of reservation.items) {
      await this.repo.release(reservation.store, sku, quantity);
    }
    return this.getReservation(id);
  }

  // ---------- Ayudantes ----------

  private async closeOrFail(id: string, status: "CONFIRMED" | "RELEASED") {
    const reservation = await this.getReservation(id);
    // El cambio de estado es condicional, así dos peticiones a la vez no cierran la misma reserva dos veces.
    if (!(await this.repo.closeReservation(id, status, this.timestamp()))) {
      throw conflict("RESERVATION_CLOSED", `La reserva '${id}' ya está ${reservation.status}`);
    }
    return reservation;
  }

  private async takeAll(
    store: string,
    items: LineItem[],
    take: (store: string, sku: string, qty: number) => Promise<boolean>,
    undo: (store: string, sku: string, qty: number) => Promise<void>,
  ) {
    const done: LineItem[] = [];
    for (const item of items) {
      if (await take(store, item.sku, item.quantity)) {
        done.push(item);
        continue;
      }
      for (const d of done) await undo(store, d.sku, d.quantity);
      throw await this.shortageError(store, items);
    }
  }

  private async shortageError(store: string, items: LineItem[]): Promise<AppError> {
    const shortages: Shortage[] = [];
    for (const { sku, quantity } of items) {
      const level = await this.repo.getStock(store, sku);
      const available = level ? level.quantity - level.reserved : 0;
      if (available < quantity) shortages.push({ sku, requested: quantity, available });
    }
    return conflict("INSUFFICIENT_STOCK", `Existencia insuficiente en la tienda '${store}'`, shortages);
  }

  private async requireStore(code: string) {
    if (!(await this.repo.getStore(code))) throw notFound("Tienda", code);
  }

  private async requireProducts(skus: string[]) {
    for (const sku of new Set(skus)) {
      if (!(await this.repo.getProduct(sku))) throw notFound("Producto", sku);
    }
  }

  private movement(
    type: MovementType,
    store: string,
    sku: string,
    quantity: number,
    extra: { reference?: string; reason?: string } = {},
  ): Movement {
    return { id: this.newId(), type, store, sku, quantity, ...extra, createdAt: this.timestamp() };
  }
}
