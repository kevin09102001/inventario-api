import { z } from "zod";

const code = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9_-]+$/, "Solo letras, números, guion y guion bajo");

const quantity = z.number().int().positive();

const lineItems = z
  .array(z.object({ sku: code, quantity }))
  .min(1, "Debe traer al menos una línea")
  .max(200);

export const createStoreSchema = z.object({
  code,
  name: z.string().trim().min(1).max(100),
});

export const createProductSchema = z
  .object({
    sku: code,
    name: z.string().trim().min(1).max(150),
    price: z.number().nonnegative(),
    cost: z.number().nonnegative(),
  });

export const adjustmentSchema = z.object({
  store: code,
  sku: code,
  quantity: z.number().int().refine((n) => n !== 0, "No puede ser cero"),
  reason: z.string().trim().min(3).max(200),
});

export const transferSchema = z.object({
  from: code,
  to: code,
  items: lineItems,
  note: z.string().trim().max(200).optional(),
});

export const reservationSchema = z.object({
  store: code,
  items: lineItems,
  reference: z.string().trim().max(50).optional(),
});

export const stockQuerySchema = z.object({
  store: code.optional(),
  sku: code.optional(),
});

export const lowStockQuerySchema = z.object({
  threshold: z.coerce.number().int().min(0).default(5),
  store: code.optional(),
});

export const movementsQuerySchema = z.object({
  store: code.optional(),
  sku: code.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
