import { MongoClient, type Collection, type Db } from "mongodb";
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

type WithId<T, K extends keyof T> = Omit<T, K> & { _id: T[K] };

type StoreDoc = WithId<Store, "code">;
type ProductDoc = WithId<Product, "sku">;
type MovementDoc = WithId<Movement, "id">;
type TransferDoc = WithId<Transfer, "id">;
type ReservationDoc = WithId<Reservation, "id">;

const DUPLICATE_KEY = 11000;

const isDuplicate = (err: unknown) =>
  typeof err === "object" && err !== null && (err as { code?: number }).code === DUPLICATE_KEY;

/** Lo disponible es cantidad - reservado; la condición va dentro del update para que sea atómica. */
const hasAvailable = (quantity: number) => ({
  $expr: { $gte: [{ $subtract: ["$quantity", "$reserved"] }, quantity] },
});

export class MongoRepository implements InventoryRepository {
  private stores: Collection<StoreDoc>;
  private products: Collection<ProductDoc>;
  private stock: Collection<StockLevel>;
  private movements: Collection<MovementDoc>;
  private transfers: Collection<TransferDoc>;
  private reservations: Collection<ReservationDoc>;

  private constructor(
    private client: MongoClient,
    db: Db,
  ) {
    this.stores = db.collection("stores");
    this.products = db.collection("products");
    this.stock = db.collection("stock");
    this.movements = db.collection("movements");
    this.transfers = db.collection("transfers");
    this.reservations = db.collection("reservations");
  }

  static async connect(url: string, dbName: string) {
    const client = new MongoClient(url, { ignoreUndefined: true });
    await client.connect();
    const repo = new MongoRepository(client, client.db(dbName));
    await repo.ensureIndexes();
    return repo;
  }

  private async ensureIndexes() {
    await this.stock.createIndex({ store: 1, sku: 1 }, { unique: true });
    await this.movements.createIndex({ store: 1, sku: 1, createdAt: -1 });
  }

  async createStore(store: Store) {
    const { code, ...rest } = store;
    try {
      await this.stores.insertOne({ _id: code, ...rest });
      return true;
    } catch (err) {
      if (isDuplicate(err)) return false;
      throw err;
    }
  }
  async getStore(code: string) {
    const doc = await this.stores.findOne({ _id: code });
    return doc ? toStore(doc) : null;
  }
  async listStores() {
    return (await this.stores.find().sort({ _id: 1 }).toArray()).map(toStore);
  }

  async createProduct(product: Product) {
    const { sku, ...rest } = product;
    try {
      await this.products.insertOne({ _id: sku, ...rest });
      return true;
    } catch (err) {
      if (isDuplicate(err)) return false;
      throw err;
    }
  }
  async getProduct(sku: string) {
    const doc = await this.products.findOne({ _id: sku });
    return doc ? toProduct(doc) : null;
  }
  async listProducts() {
    return (await this.products.find().sort({ _id: 1 }).toArray()).map(toProduct);
  }

  async getStock(store: string, sku: string) {
    return this.stock.findOne({ store, sku }, { projection: { _id: 0 } });
  }
  async listStock(filter: StockFilter) {
    const query: Partial<StockLevel> = {};
    if (filter.store) query.store = filter.store;
    if (filter.sku) query.sku = filter.sku;
    return this.stock.find(query, { projection: { _id: 0 } }).sort({ store: 1, sku: 1 }).toArray();
  }
  async increment(store: string, sku: string, quantity: number) {
    await this.stock.updateOne(
      { store, sku },
      { $inc: { quantity }, $setOnInsert: { reserved: 0 } },
      { upsert: true },
    );
  }
  async tryDecrement(store: string, sku: string, quantity: number) {
    const res = await this.stock.updateOne(
      { store, sku, ...hasAvailable(quantity) },
      { $inc: { quantity: -quantity } },
    );
    return res.modifiedCount === 1;
  }
  async tryReserve(store: string, sku: string, quantity: number) {
    const res = await this.stock.updateOne(
      { store, sku, ...hasAvailable(quantity) },
      { $inc: { reserved: quantity } },
    );
    return res.modifiedCount === 1;
  }
  async release(store: string, sku: string, quantity: number) {
    await this.stock.updateOne({ store, sku }, { $inc: { reserved: -quantity } });
  }
  async consumeReserved(store: string, sku: string, quantity: number) {
    await this.stock.updateOne({ store, sku }, { $inc: { reserved: -quantity, quantity: -quantity } });
  }

  async addMovements(movements: Movement[]) {
    if (movements.length === 0) return;
    await this.movements.insertMany(movements.map(({ id, ...rest }) => ({ _id: id, ...rest })));
  }
  async listMovements(filter: MovementFilter) {
    const query: Record<string, string> = {};
    if (filter.store) query.store = filter.store;
    if (filter.sku) query.sku = filter.sku;
    const docs = await this.movements
      .find(query)
      .sort({ createdAt: -1 })
      .limit(filter.limit ?? 100)
      .toArray();
    return docs.map(({ _id, ...rest }) => ({ id: _id, ...rest }));
  }

  async addTransfer(transfer: Transfer) {
    const { id, ...rest } = transfer;
    await this.transfers.insertOne({ _id: id, ...rest });
  }
  async getTransfer(id: string) {
    const doc = await this.transfers.findOne({ _id: id });
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return { id: _id, ...rest };
  }

  async addReservation(reservation: Reservation) {
    const { id, ...rest } = reservation;
    await this.reservations.insertOne({ _id: id, ...rest });
  }
  async getReservation(id: string) {
    const doc = await this.reservations.findOne({ _id: id });
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return { id: _id, ...rest };
  }
  async closeReservation(id: string, status: Exclude<ReservationStatus, "ACTIVE">, at: Date) {
    const res = await this.reservations.updateOne(
      { _id: id, status: "ACTIVE" },
      { $set: { status, closedAt: at } },
    );
    return res.modifiedCount === 1;
  }

  /** Solo para pruebas: deja la base vacía. */
  async reset() {
    await Promise.all(
      [this.stores, this.products, this.stock, this.movements, this.transfers, this.reservations].map((c) =>
        c.deleteMany({}),
      ),
    );
  }

  async close() {
    await this.client.close();
  }
}

function toStore({ _id, ...rest }: StoreDoc): Store {
  return { code: _id, ...rest };
}

function toProduct({ _id, ...rest }: ProductDoc): Product {
  return { sku: _id, ...rest };
}
