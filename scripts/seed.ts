/**
 * Carga datos de ejemplo: 3 tiendas, 6 productos y existencia inicial.
 * Uso: MONGO_URL=mongodb://localhost:27017 npm run seed
 */
import { MongoRepository } from "../src/repositories/mongo.js";
import { InventoryService } from "../src/services/inventory.js";

const url = process.env.MONGO_URL;
if (!url) {
  console.error("Definí MONGO_URL, por ejemplo: MONGO_URL=mongodb://localhost:27017 npm run seed");
  process.exit(1);
}

const repo = await MongoRepository.connect(url, process.env.MONGO_DB ?? "inventario");
await repo.reset();
const service = new InventoryService(repo);

const stores = [
  { code: "TGU01", name: "Tegucigalpa Centro" },
  { code: "TGU02", name: "Tegucigalpa Mall" },
  { code: "SPS01", name: "San Pedro Sula" },
];
const products = [
  { sku: "ZAP-001", name: "Tenis deportivo", price: 1250, cost: 700 },
  { sku: "ZAP-002", name: "Sandalia de playa", price: 350, cost: 150 },
  { sku: "ZAP-003", name: "Bota de trabajo", price: 1800, cost: 1050 },
  { sku: "CAR-010", name: "Cartera de cuero", price: 890, cost: 420 },
  { sku: "MOC-020", name: "Mochila escolar", price: 600, cost: 280 },
  { sku: "REL-030", name: "Reloj digital", price: 450, cost: 190 },
];

for (const s of stores) await service.createStore(s);
for (const p of products) await service.createProduct(p);

for (const s of stores) {
  for (const p of products) {
    const quantity = Math.floor(Math.random() * 40) + 1;
    await service.adjust({ store: s.code, sku: p.sku, quantity, reason: "Inventario inicial" });
  }
}

console.log(`Listo: ${stores.length} tiendas, ${products.length} productos con existencia inicial.`);
await repo.close();
