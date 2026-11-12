import type {
  Movement,
  Product,
  Reservation,
  ReservationStatus,
  StockLevel,
  Store,
  Transfer,
} from "../domain/types.js";

export interface StockFilter {
  store?: string;
  sku?: string;
}

export interface MovementFilter {
  store?: string;
  sku?: string;
  limit?: number;
}

/**
 * Operaciones de acceso a datos. Las operaciones de existencias son atómicas
 * por registro (tienda + SKU): nunca dejan la cantidad disponible en negativo.
 */
export interface InventoryRepository {
  createStore(store: Store): Promise<boolean>;
  getStore(code: string): Promise<Store | null>;
  listStores(): Promise<Store[]>;

  createProduct(product: Product): Promise<boolean>;
  getProduct(sku: string): Promise<Product | null>;
  listProducts(): Promise<Product[]>;

  getStock(store: string, sku: string): Promise<StockLevel | null>;
  listStock(filter: StockFilter): Promise<StockLevel[]>;
  /** Suma a la existencia (crea el registro si no existe). */
  increment(store: string, sku: string, quantity: number): Promise<void>;
  /** Resta solo si lo disponible (cantidad - reservado) alcanza. */
  tryDecrement(store: string, sku: string, quantity: number): Promise<boolean>;
  /** Aparta existencia solo si lo disponible alcanza. */
  tryReserve(store: string, sku: string, quantity: number): Promise<boolean>;
  /** Devuelve existencia apartada a disponible. */
  release(store: string, sku: string, quantity: number): Promise<void>;
  /** Saca de inventario una cantidad que ya estaba apartada. */
  consumeReserved(store: string, sku: string, quantity: number): Promise<void>;

  addMovements(movements: Movement[]): Promise<void>;
  listMovements(filter: MovementFilter): Promise<Movement[]>;

  addTransfer(transfer: Transfer): Promise<void>;
  getTransfer(id: string): Promise<Transfer | null>;

  addReservation(reservation: Reservation): Promise<void>;
  getReservation(id: string): Promise<Reservation | null>;
  /** Cambia el estado solo si la reserva sigue ACTIVE. Devuelve si cambió. */
  closeReservation(id: string, status: Exclude<ReservationStatus, "ACTIVE">, at: Date): Promise<boolean>;

  close(): Promise<void>;
}
