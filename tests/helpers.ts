import { MemoryRepository } from "../src/repositories/memory.js";
import { MongoRepository } from "../src/repositories/mongo.js";
import type { InventoryRepository } from "../src/repositories/repository.js";
import { InventoryService } from "../src/services/inventory.js";

/**
 * Si MONGO_URL está definida, las pruebas corren contra MongoDB real
 * (así se corren en CI); si no, contra el repositorio en memoria.
 */
export const usingMongo = Boolean(process.env.MONGO_URL);

let mongo: MongoRepository | undefined;

export async function freshRepo(): Promise<InventoryRepository> {
  if (!usingMongo) return new MemoryRepository();
  mongo ??= await MongoRepository.connect(process.env.MONGO_URL!, "inventario_test");
  await mongo.reset();
  return mongo;
}

export async function closeRepo() {
  await mongo?.close();
  mongo = undefined;
}

/** Datos base: dos tiendas, dos productos y 10 unidades de cada uno en TGU01. */
export async function seededService() {
  const service = new InventoryService(await freshRepo());
  await service.createStore({ code: "TGU01", name: "Tegucigalpa Centro" });
  await service.createStore({ code: "SPS01", name: "San Pedro Sula" });
  await service.createProduct({ sku: "ZAP-001", name: "Tenis deportivo", price: 1250, cost: 700 });
  await service.createProduct({ sku: "CAR-010", name: "Cartera de cuero", price: 890, cost: 420 });
  await service.adjust({ store: "TGU01", sku: "ZAP-001", quantity: 10, reason: "Inventario inicial" });
  await service.adjust({ store: "TGU01", sku: "CAR-010", quantity: 10, reason: "Inventario inicial" });
  return service;
}
