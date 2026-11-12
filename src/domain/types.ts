export interface Store {
  code: string;
  name: string;
  createdAt: Date;
}

export interface Product {
  sku: string;
  name: string;
  price: number;
  cost: number;
  createdAt: Date;
}

export interface StockLevel {
  store: string;
  sku: string;
  quantity: number;
  reserved: number;
}

export type MovementType =
  | "ADJUSTMENT_IN"
  | "ADJUSTMENT_OUT"
  | "TRANSFER_OUT"
  | "TRANSFER_IN"
  | "SALE";

export interface Movement {
  id: string;
  type: MovementType;
  store: string;
  sku: string;
  quantity: number;
  reference?: string;
  reason?: string;
  createdAt: Date;
}

export interface LineItem {
  sku: string;
  quantity: number;
}

export interface Transfer {
  id: string;
  from: string;
  to: string;
  items: LineItem[];
  note?: string;
  createdAt: Date;
}

export type ReservationStatus = "ACTIVE" | "CONFIRMED" | "RELEASED";

export interface Reservation {
  id: string;
  store: string;
  items: LineItem[];
  status: ReservationStatus;
  reference?: string;
  createdAt: Date;
  closedAt?: Date;
}
