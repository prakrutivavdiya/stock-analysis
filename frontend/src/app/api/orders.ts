import { apiFetch } from "./client";
import type {
  OrdersResponse,
  PlaceOrderRequest,
  PlaceOrderResponse,
  ModifyOrderResponse,
  CancelOrderResponse,
  ApiOrder,
} from "./types";
import type { Order } from "../data/mockData";

export function getOrders(): Promise<OrdersResponse> {
  return apiFetch<OrdersResponse>("/orders");
}

export function placeOrder(body: PlaceOrderRequest): Promise<PlaceOrderResponse> {
  return apiFetch<PlaceOrderResponse>("/orders", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function modifyOrder(
  orderId: string,
  body: {
    variety: string;
    order_type: string;
    quantity?: number;
    price?: number;
    trigger_price?: number;
  }
): Promise<ModifyOrderResponse> {
  return apiFetch<ModifyOrderResponse>(`/orders/${orderId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function cancelOrder(
  orderId: string,
  variety = "regular"
): Promise<CancelOrderResponse> {
  return apiFetch<CancelOrderResponse>(
    `/orders/${orderId}?variety=${encodeURIComponent(variety)}`,
    { method: "DELETE" }
  );
}

export function getOrderHistory(
  orderId: string
): Promise<{ order_id: string; history: unknown[] }> {
  return apiFetch<{ order_id: string; history: unknown[] }>(
    `/orders/${orderId}/history`
  );
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

export function mapOrder(o: ApiOrder): Order {
  return {
    id: o.order_id,
    symbol: o.tradingsymbol,
    exchange: o.exchange,
    variety: o.variety,
    type: o.transaction_type,
    product: o.product as Order["product"],
    quantity: o.quantity,
    price: o.price,
    orderType: o.order_type,
    validity: o.validity,
    status: o.status,
    time: o.placed_at
      ? new Date(o.placed_at).toLocaleTimeString("en-IN", { hour12: false })
      : "—",
    triggerPrice: o.trigger_price ?? undefined,
    filledQuantity: o.filled_quantity,
    averagePrice: o.average_price,
  };
}
