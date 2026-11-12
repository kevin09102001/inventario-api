import { createApp } from "./http/app.js";
import { MemoryRepository } from "./repositories/memory.js";
import { MongoRepository } from "./repositories/mongo.js";
import type { InventoryRepository } from "./repositories/repository.js";
import { InventoryService } from "./services/inventory.js";

const port = Number(process.env.PORT ?? 3000);
const mongoUrl = process.env.MONGO_URL;
const dbName = process.env.MONGO_DB ?? "inventario";

async function main() {
  let repo: InventoryRepository;
  if (mongoUrl) {
    repo = await MongoRepository.connect(mongoUrl, dbName);
    console.log(`Conectado a MongoDB (${dbName})`);
  } else {
    repo = new MemoryRepository();
    console.warn("MONGO_URL no está definida: usando almacenamiento en memoria (los datos se pierden al reiniciar)");
  }

  const app = createApp(new InventoryService(repo));
  const server = app.listen(port, () => {
    console.log(`API escuchando en http://localhost:${port} (documentación en /docs)`);
  });

  const shutdown = () => {
    server.close(async () => {
      await repo.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
