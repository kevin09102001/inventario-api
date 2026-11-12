import express, { type NextFunction, type Request, type Response } from "express";
import { readFileSync } from "node:fs";
import swaggerUi from "swagger-ui-express";
import YAML from "yaml";
import { z } from "zod";
import { AppError } from "../domain/errors.js";
import type { InventoryService } from "../services/inventory.js";
import {
  adjustmentSchema,
  createProductSchema,
  createStoreSchema,
  lowStockQuerySchema,
  movementsQuerySchema,
  reservationSchema,
  stockQuerySchema,
  transferSchema,
} from "./schemas.js";

const openApi = YAML.parse(readFileSync(new URL("../../docs/openapi.yaml", import.meta.url), "utf8"));

export function createApp(service: InventoryService) {
  const app = express();
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApi));

  // Tiendas y productos
  app.post("/stores", async (req, res) => {
    res.status(201).json(await service.createStore(createStoreSchema.parse(req.body)));
  });
  app.get("/stores", async (_req, res) => {
    res.json(await service.listStores());
  });

  app.post("/products", async (req, res) => {
    res.status(201).json(await service.createProduct(createProductSchema.parse(req.body)));
  });
  app.get("/products", async (_req, res) => {
    res.json(await service.listProducts());
  });
  app.get("/products/:sku", async (req, res) => {
    res.json(await service.getProduct(req.params.sku));
  });

  // Existencias
  app.get("/stock", async (req, res) => {
    res.json(await service.listStock(stockQuerySchema.parse(req.query)));
  });
  app.get("/reports/low-stock", async (req, res) => {
    const { threshold, store } = lowStockQuerySchema.parse(req.query);
    res.json(await service.lowStock(threshold, store));
  });
  app.get("/movements", async (req, res) => {
    res.json(await service.listMovements(movementsQuerySchema.parse(req.query)));
  });
  app.post("/adjustments", async (req, res) => {
    res.status(201).json(await service.adjust(adjustmentSchema.parse(req.body)));
  });

  // Traslados
  app.post("/transfers", async (req, res) => {
    res.status(201).json(await service.transfer(transferSchema.parse(req.body)));
  });
  app.get("/transfers/:id", async (req, res) => {
    res.json(await service.getTransfer(req.params.id));
  });

  // Reservas
  app.post("/reservations", async (req, res) => {
    res.status(201).json(await service.reserve(reservationSchema.parse(req.body)));
  });
  app.get("/reservations/:id", async (req, res) => {
    res.json(await service.getReservation(req.params.id));
  });
  app.post("/reservations/:id/confirm", async (req, res) => {
    res.json(await service.confirmReservation(req.params.id));
  });
  app.post("/reservations/:id/release", async (req, res) => {
    res.json(await service.releaseReservation(req.params.id));
  });

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Ruta no encontrada" } });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Datos inválidos",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      });
      return;
    }
    if (err instanceof AppError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json({ error: { code: "INVALID_JSON", message: "El cuerpo no es JSON válido" } });
      return;
    }
    console.error(err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Error interno" } });
  });

  return app;
}
