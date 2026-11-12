import type {
  Movement,
  Product,
  Reservation,
  ReservationStatus,
  StockLevel,
  Store,
  Transfer,
} from "../domain/types.js";
import type { InventoryRepository, MovementFilter, StockFilter } from "./repository.js";

const key = (store: string, sku: string) => `${store}::${sku}`;

/** Implementación en memoria. Se usa en pruebas y para correr la API sin base de datos. */
export class MemoryRepository implements InventoryRepository {
  private stores = new Map<string, Store>();
  private products = new Map<string, Product>();
  private stock = new Map<string, StockLevel>();
  private movements: Movement[] = [];
  private transfers = new Map<string, Transfer>();
  private reservations = new Map<string, Reservation>();

  async createStore(store: Store) {
    if (this.stores.has(store.code)) return false;
    this.stores.set(store.code, { ...store });
    return true;
  }
  async getStore(code: string) {
    return this.stores.get(code) ?? null;
  }
  async listStores() {
    return [...this.stores.values()].sort((a, b) => a.code.localeCompare(b.code));
  }

  async createProduct(product: Product) {
    if (this.products.has(product.sku)) return false;
    this.products.set(product.sku, { ...product });
    return true;
  }
  async getProduct(sku: string) {
    return this.products.get(sku) ?? null;
  }
  async listProducts() {
    return [...this.products.values()].sort((a, b) => a.sku.localeCompare(b.sku));
  }

  async getStock(store: string, sku: string) {
    const level = this.stock.get(key(store, sku));
    return level ? { ...level } : null;
  }
  async listStock(filter: StockFilter) {
    return [...this.stock.values()]
      .filter((s) => (!filter.store || s.store === filter.store) && (!filter.sku || s.sku === filter.sku))
      .map((s) => ({ ...s }))
      .sort((a, b) => a.store.localeCompare(b.store) || a.sku.localeCompare(b.sku));
  }
  private level(store: string, sku: string) {
    const k = key(store, sku);
    let level = this.stock.get(k);
    if (!level) {
      level = { store, sku, quantity: 0, reserved: 0 };
      this.stock.set(k, level);
    }
    return level;
  }
  async increment(store: string, sku: string, quantity: number) {
    this.level(store, sku).quantity += quantity;
  }
  async tryDecrement(store: string, sku: string, quantity: number) {
    const level = this.stock.get(key(store, sku));
    if (!level || level.quantity - level.reserved < quantity) return false;
    level.quantity -= quantity;
    return true;
  }
  async tryReserve(store: string, sku: string, quantity: number) {
    const level = this.stock.get(key(store, sku));
    if (!level || level.quantity - level.reserved < quantity) return false;
    level.reserved += quantity;
    return true;
  }
  async release(store: string, sku: string, quantity: number) {
    this.level(store, sku).reserved -= quantity;
  }
  async consumeReserved(store: string, sku: string, quantity: number) {
    const level = this.level(store, sku);
    level.reserved -= quantity;
    level.quantity -= quantity;
  }

  async addMovements(movements: Movement[]) {
    this.movements.push(...movements.map((m) => ({ ...m })));
  }
  async listMovements(filter: MovementFilter) {
    return this.movements
      .filter((m) => (!filter.store || m.store === filter.store) && (!filter.sku || m.sku === filter.sku))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, filter.limit ?? 100);
  }

  async addTransfer(transfer: Transfer) {
    this.transfers.set(transfer.id, structuredClone(transfer));
  }
  async getTransfer(id: string) {
    return this.transfers.get(id) ?? null;
  }

  async addReservation(reservation: Reservation) {
    this.reservations.set(reservation.id, structuredClone(reservation));
  }
  async getReservation(id: string) {
    return this.reservations.get(id) ?? null;
  }
  async closeReservation(id: string, status: Exclude<ReservationStatus, "ACTIVE">, at: Date) {
    const r = this.reservations.get(id);
    if (!r || r.status !== "ACTIVE") return false;
    r.status = status;
    r.closedAt = at;
    return true;
  }

  async close() {}
}
