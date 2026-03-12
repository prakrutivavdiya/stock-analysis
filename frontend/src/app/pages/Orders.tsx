import { useState, useMemo, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router";
import { AlertTriangle, ChevronDown, ChevronUp, ChevronsUpDown, ExternalLink, Info, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { Order, GTTOrder } from "../data/mockData";
import { useAppStore, TTL_MS, isFresh } from "../data/store";
import { getHoldings, mapHolding } from "../api/portfolio";
import { getOrders, placeOrder, modifyOrder as apiModifyOrder, cancelOrder, mapOrder } from "../api/orders";
import { getGtts, placeGtt, modifyGtt as apiModifyGtt, deleteGtt, mapGtt } from "../api/gtt";
import { ApiError } from "../api/client";

type Tab = "orders" | "gtt";
type TxType = "BUY" | "SELL";
type Product = "CNC" | "MIS" | "NRML";
type OrderType = "MARKET" | "LIMIT" | "SL" | "SL-M";
type Validity = "DAY" | "IOC" | "TTL"; // PRD §5.4
type GttType = "single" | "two-leg";

// Equity exchanges support CNC (Delivery) + MIS (Intraday)
// F&O / Commodity exchanges support NRML (Overnight) + MIS (Intraday)
function isEquityExchange(exchange: string) {
  return exchange === "NSE" || exchange === "BSE";
}

function productOptions(exchange: string): { value: Product; label: string }[] {
  if (isEquityExchange(exchange)) {
    return [
      { value: "CNC", label: "Delivery (CNC)" },
      { value: "MIS", label: "Intraday (MIS)" },
    ];
  }
  return [
    { value: "NRML", label: "Overnight (NRML)" },
    { value: "MIS",  label: "Intraday (MIS)" },
  ];
}

function defaultProduct(exchange: string): Product {
  return isEquityExchange(exchange) ? "CNC" : "NRML";
}

interface OrderForm {
  symbol: string;
  exchange: string;
  txType: TxType;
  product: Product;
  quantity: string;
  orderType: OrderType;
  price: string;
  triggerPrice: string;
  validity: Validity;
  ttlMinutes: string;
}

interface GttForm {
  symbol: string;
  txType: TxType;
  gttType: GttType;
  product: Product;
  quantity: string;
  upperTrigger: string;
  upperLimit: string;
  lowerTrigger: string;
  lowerLimit: string;
  singleTrigger: string;
  singleLimit: string;
}

const EMPTY_ORDER: OrderForm = {
  symbol: "",
  exchange: "NSE",
  txType: "BUY",
  product: "CNC",     // TR-09: default CNC
  quantity: "",
  orderType: "LIMIT",
  price: "",
  triggerPrice: "",
  validity: "DAY",    // TR-10: default DAY
  ttlMinutes: "15",
};

const EMPTY_GTT: GttForm = {
  symbol: "",
  txType: "BUY",
  gttType: "two-leg",
  product: "CNC",
  quantity: "",
  upperTrigger: "",
  upperLimit: "",
  lowerTrigger: "",
  lowerLimit: "",
  singleTrigger: "",
  singleLimit: "",
};

type SortKey = "symbol" | "type" | "status" | "time";
type SortDir = "asc" | "desc";

// PRD 5.7: Estimated charges calculation
function computeCharges(
  product: Product,
  txType: TxType,
  exchange: string,
  quantity: number,
  price: number
) {
  const tradeValue = quantity * price;

  // Brokerage: ₹0 for CNC, min(0.03%, ₹20) for MIS/NRML
  const brokerage = product === "CNC" ? 0 : Math.min(tradeValue * 0.0003, 20);

  // STT: 0.1% CNC (buy+sell), 0.025% MIS sell only
  let stt = 0;
  if (product === "CNC") {
    stt = tradeValue * 0.001;
  } else if (product === "MIS" && txType === "SELL") {
    stt = tradeValue * 0.00025;
  }

  // Exchange charges: 0.00345% NSE / 0.00375% BSE
  const exchRate = exchange === "BSE" ? 0.0000375 : 0.0000345;
  const exchCharges = tradeValue * exchRate;

  // GST: 18% on (brokerage + exchange charges)
  const gst = (brokerage + exchCharges) * 0.18;

  // SEBI: ₹10 per crore
  const sebi = (tradeValue / 10_000_000) * 10;

  // Stamp duty: 0.015% on buy side only
  const stampDuty = txType === "BUY" ? tradeValue * 0.00015 : 0;

  const total = brokerage + stt + exchCharges + gst + sebi + stampDuty;
  return { brokerage, stt, exchCharges, gst, sebi, stampDuty, total };
}

function fmt(n: number) {
  return `₹${n.toFixed(2)}`;
}

// TR-13: Determine if NSE/BSE market is open (09:15–15:30 IST, Mon–Fri)
function isNseMarketOpen(): boolean {
  const now = new Date();
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const day = ist.getDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const h = ist.getHours();
  const m = ist.getMinutes();
  const mins = h * 60 + m;
  return mins >= 9 * 60 + 15 && mins < 15 * 60 + 30;
}

export default function Orders() {
  const [tab, setTab] = useState<Tab>("orders");
  const [orders, setOrders] = useState<Order[]>([]);
  const [gttOrders, setGttOrders] = useState<GTTOrder[]>([]);
  const [orderForm, setOrderForm] = useState<OrderForm>(EMPTY_ORDER);
  const [gttForm, setGttForm] = useState<GttForm>(EMPTY_GTT);
  const [showOrderReview, setShowOrderReview] = useState(false);
  // TR-12: MARKET slippage ack
  const [slippageAcked, setSlippageAcked] = useState(false);
  const [showSlippageWarning, setShowSlippageWarning] = useState(false);
  // Modify order state
  const [modifyOrder, setModifyOrder] = useState<Order | null>(null);
  const [modifyForm, setModifyForm] = useState({ quantity: "", price: "", triggerPrice: "" });
  // GTT modify/delete state
  const [modifyGtt, setModifyGtt] = useState<GTTOrder | null>(null);
  const [modifyGttForm, setModifyGttForm] = useState({
    quantity: "",
    singleTrigger: "", singleLimit: "",
    upperTrigger: "", upperLimit: "",
    lowerTrigger: "", lowerLimit: "",
  });
  const [deleteGttId, setDeleteGttId] = useState<string | null>(null);
  // TR-17: Paper trade mode
  const [paperMode, setPaperMode] = useState(false);

  // CDSL / eDIS authorization flow
  interface CdslPending {
    isin: string;
    qty: number;
    exchange: string;
    pendingForm: OrderForm;
  }
  const [cdslPending, setCdslPending] = useState<CdslPending | null>(null);
  const [cdslAuthUrl, setCdslAuthUrl] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [searchParams, setSearchParams] = useSearchParams();

  // Store access for holdings (used for symbol list + sell checks)
  const storeHoldings = useAppStore((s) => s.holdings);
  const setStoreHoldings = useAppStore((s) => s.setHoldings);
  const holdings = storeHoldings.data ?? [];
  const livePrices = useAppStore((s) => s.livePrices);

  // Load data on mount
  useEffect(() => {
    // Fetch orders
    getOrders()
      .then((res) => setOrders(res.orders.map(mapOrder)))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status !== 401)
          toast.error(err.message || "Failed to load orders");
      });

    // Fetch GTTs
    getGtts()
      .then((res) => setGttOrders(res.gtts.map(mapGtt)))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status !== 401)
          toast.error(err.message || "Failed to load GTTs");
      });

    // Fetch holdings if not fresh (for symbol list + oversell check)
    if (!isFresh(storeHoldings.fetchedAt, TTL_MS.holdings)) {
      getHoldings()
        .then((res) => setStoreHoldings(res.holdings.map(mapHolding)))
        .catch(() => {
          // Holdings are used for convenience; don't block the page on failure
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // KITE-SQUARE-OFF: pre-fill form when navigated from Dashboard square-off button
  useEffect(() => {
    if (searchParams.get("squareOff") === "1") {
      const symbol = searchParams.get("symbol") ?? "";
      const exchange = searchParams.get("exchange") ?? "NSE";
      const product = (searchParams.get("product") ?? "MIS") as Product;
      const txType = (searchParams.get("txType") ?? "SELL") as TxType;
      const quantity = searchParams.get("quantity") ?? "";
      const orderType = (searchParams.get("orderType") ?? "MARKET") as OrderType;
      setOrderForm({
        ...EMPTY_ORDER,
        symbol,
        exchange,
        product,
        txType,
        quantity,
        orderType,
      });
      // Clear the params so a refresh doesn't re-trigger
      const next = new URLSearchParams(searchParams);
      ["squareOff", "symbol", "exchange", "product", "txType", "quantity", "orderType"].forEach((k) => next.delete(k));
      setSearchParams(next, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect CDSL callback: ?cdsl_status=completed means authorization succeeded in the new tab
  useEffect(() => {
    const cdslStatus = searchParams.get("cdsl_status");
    if (cdslStatus === "completed") {
      toast.success("CDSL authorization completed! You can now retry your sell order.");
      // Remove the query param without navigating
      const next = new URLSearchParams(searchParams);
      next.delete("cdsl_status");
      setSearchParams(next, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Computed warnings ────────────────────────────────────────────────────

  const heldQty = useMemo(() => {
    if (!orderForm.symbol || orderForm.txType !== "SELL") return null;
    const h = holdings.find((h) => h.symbol === orderForm.symbol);
    return h ? h.quantity : 0;
  }, [orderForm.symbol, orderForm.txType, holdings]);

  // TR-16 / L-05: Oversell — hard block for CNC (no short delivery), soft warning for MIS/NRML (intraday short allowed)
  const oversellError =
    orderForm.txType === "SELL" &&
    orderForm.product === "CNC" &&
    heldQty !== null &&
    Number(orderForm.quantity) > heldQty
      ? `Cannot sell ${orderForm.quantity} — you only hold ${heldQty} shares. Delivery (CNC) does not allow short selling.`
      : null;

  const oversellWarning =
    orderForm.txType === "SELL" &&
    orderForm.product !== "CNC" &&
    heldQty !== null &&
    Number(orderForm.quantity) > heldQty
      ? `Selling ${orderForm.quantity} with only ${heldQty} held — creates an intraday short position. Must square off before 3:20 PM.`
      : null;

  const ltp = useMemo(() => {
    if (!orderForm.symbol) return null;
    const h = holdings.find((h) => h.symbol === orderForm.symbol);
    if (!h) return null;
    if (h.instrumentToken != null) {
      const tick = livePrices[h.instrumentToken];
      if (tick) return tick.ltp;
    }
    return h.ltp;
  }, [orderForm.symbol, holdings, livePrices]);

  // L-06: 20% price deviation for LIMIT orders
  const deviationWarning = useMemo(() => {
    if (orderForm.orderType !== "LIMIT" || !ltp || !orderForm.price) return null;
    const price = Number(orderForm.price);
    if (!price) return null;
    const dev = Math.abs((price - ltp) / ltp);
    if (dev >= 0.2) {
      return `Limit price is ${(dev * 100).toFixed(1)}% ${price > ltp ? "above" : "below"} LTP (₹${ltp.toFixed(2)}). >20% deviation may be rejected by exchange.`;
    }
    return null;
  }, [orderForm.orderType, orderForm.price, ltp]);

  // TR-11: SL trigger/limit price relationship validation
  const slValidationError = useMemo(() => {
    if (orderForm.orderType !== "SL") return null;
    const trigger = Number(orderForm.triggerPrice);
    const limit = Number(orderForm.price);
    if (!trigger || !limit) return null;
    if (orderForm.txType === "BUY" && trigger >= limit) {
      return "BUY SL: Trigger price must be less than limit price.";
    }
    if (orderForm.txType === "SELL" && trigger <= limit) {
      return "SELL SL: Trigger price must be greater than limit price.";
    }
    return null;
  }, [orderForm.orderType, orderForm.txType, orderForm.triggerPrice, orderForm.price]);

  // TR-15: Warn if order value > 20% of available margin
  const availableMargin = useAppStore((s) => s.margins.data?.available ?? null);
  const marginWarning = useMemo(() => {
    if (!availableMargin) return null;
    const qty = Number(orderForm.quantity);
    const price = Number(orderForm.price) || ltp || 0;
    if (!qty || !price) return null;
    const orderValue = qty * price;
    if (orderValue > availableMargin * 0.2) {
      return `Order value (₹${orderValue.toLocaleString("en-IN")}) exceeds 20% of available margin (₹${(availableMargin * 0.2).toLocaleString("en-IN")}).`;
    }
    return null;
  }, [orderForm.quantity, orderForm.price, ltp, availableMargin]);

  // Quantity must be a positive whole number
  const qtyError = useMemo(() => {
    if (!orderForm.quantity) return null;
    const q = Number(orderForm.quantity);
    if (!Number.isInteger(q) || q < 1) return "Quantity must be a whole number ≥ 1.";
    return null;
  }, [orderForm.quantity]);

  // Price required for LIMIT / SL
  const priceRequiredError = useMemo(() => {
    const requiresPrice = orderForm.orderType === "LIMIT" || orderForm.orderType === "SL";
    if (!requiresPrice) return null;
    const p = Number(orderForm.price);
    if (!orderForm.price || p <= 0) return "Price is required and must be greater than ₹0.";
    return null;
  }, [orderForm.orderType, orderForm.price]);

  // Trigger price required for SL / SL-M
  const triggerRequiredError = useMemo(() => {
    const requiresTrigger = orderForm.orderType === "SL" || orderForm.orderType === "SL-M";
    if (!requiresTrigger) return null;
    const t = Number(orderForm.triggerPrice);
    if (!orderForm.triggerPrice || t <= 0) return "Trigger price is required and must be greater than ₹0.";
    return null;
  }, [orderForm.orderType, orderForm.triggerPrice]);

  // Tick size: NSE/BSE equity prices must be in multiples of ₹0.05
  const tickSizeError = useMemo(() => {
    const isEquity = isEquityExchange(orderForm.exchange);
    if (!isEquity) return null;
    const checkTick = (val: string) => {
      const v = Number(val);
      if (!val || !v) return true;
      return Math.abs(Math.round(v * 20) - v * 20) < 0.0001;
    };
    const errors: string[] = [];
    if (orderForm.price && !checkTick(orderForm.price))
      errors.push("Price must be a multiple of ₹0.05.");
    if (orderForm.triggerPrice && !checkTick(orderForm.triggerPrice))
      errors.push("Trigger price must be a multiple of ₹0.05.");
    return errors.length > 0 ? errors.join(" ") : null;
  }, [orderForm.price, orderForm.triggerPrice, orderForm.exchange]);

  // Estimated charges for confirmation dialog
  const charges = useMemo(() => {
    const qty = Number(orderForm.quantity);
    const price = Number(orderForm.price) || ltp || 0;
    if (!qty || !price) return null;
    return computeCharges(orderForm.product, orderForm.txType, orderForm.exchange, qty, price);
  }, [orderForm.product, orderForm.txType, orderForm.exchange, orderForm.quantity, orderForm.price, ltp]);

  // ── Sort ─────────────────────────────────────────────────────────────────

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const sorted = useMemo(() => {
    return [...orders].sort((a, b) => {
      const av = a[sortKey] as string;
      const bv = b[sortKey] as string;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [orders, sortKey, sortDir]);

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortDir === "asc"
      ? <ChevronUp className="w-3 h-3 ml-1 text-[#FF6600]" />
      : <ChevronDown className="w-3 h-3 ml-1 text-[#FF6600]" />;
  };

  // ── Order form ────────────────────────────────────────────────────────────

  const setOf = <K extends keyof OrderForm>(k: K, v: OrderForm[K]) =>
    setOrderForm((f) => ({ ...f, [k]: v }));

  const needsTrigger = orderForm.orderType === "SL" || orderForm.orderType === "SL-M";
  const needsPrice = orderForm.orderType === "LIMIT" || orderForm.orderType === "SL";

  const canSubmit =
    !!orderForm.symbol &&
    !!orderForm.quantity &&
    !qtyError &&
    !priceRequiredError &&
    !triggerRequiredError &&
    !slValidationError &&
    !oversellError &&
    !tickSizeError;

  const handlePlaceOrder = () => {
    if (!canSubmit) return;
    // TR-12: MARKET orders require slippage acknowledgement
    if (orderForm.orderType === "MARKET" && !slippageAcked) {
      setShowSlippageWarning(true);
      return;
    }
    setShowOrderReview(true);
  };

  const user = useAppStore((s) => s.user);

  // Open the CDSL form served by our backend in a new popup window.
  // The backend calls POST https://api.kite.trade/tpin/generate with the user's Kite
  // access token, gets back the CDSL HTML form, and serves it directly to the browser.
  const openCdslForm = useCallback((isin: string, qty: number, exchange: string) => {
    const params = new URLSearchParams({ isin, qty: String(qty), exchange });
    const url = `/api/v1/orders/cdsl/form?${params}`;
    const popup = window.open(url, "cdsl_auth", "width=900,height=650,noopener,noreferrer");
    if (!popup) {
      toast.error("Popup was blocked. Please allow popups for this site and try again.");
    }
    setCdslAuthUrl(url);
  }, []);

  const handleConfirmOrder = async () => {
    setShowOrderReview(false);
    try {
      // TR-13: Auto-select AMO variety outside market hours
      const variety = isNseMarketOpen() ? "regular" : "amo";
      await placeOrder({
        tradingsymbol: orderForm.symbol,
        exchange: orderForm.exchange,
        transaction_type: orderForm.txType,
        quantity: Number(orderForm.quantity),
        product: orderForm.product,
        order_type: orderForm.orderType,
        variety,
        price: orderForm.price ? Number(orderForm.price) : undefined,
        trigger_price: orderForm.triggerPrice ? Number(orderForm.triggerPrice) : undefined,
        validity: orderForm.validity,
        validity_ttl: orderForm.validity === "TTL" ? Number(orderForm.ttlMinutes) || 15 : undefined,
        paper_trade: paperMode || (user?.paper_trade_mode ?? false),
      });
      toast.success(`Order placed — ${orderForm.txType} ${orderForm.symbol}`);
      setOrderForm(EMPTY_ORDER);
      setSlippageAcked(false);
      // Refresh orders list
      getOrders()
        .then((res) => setOrders(res.orders.map(mapOrder)))
        .catch(() => {});
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 401) return;
        const errorCode = (err.detail?.error as Record<string, unknown> | undefined)?.code;
        if (errorCode === "CDSL_AUTH_REQUIRED") {
          // Look up ISIN from holdings store
          const holding = holdings.find((h) => h.symbol === orderForm.symbol);
          const isin = holding?.isin ?? "";
          setCdslPending({
            isin,
            qty: Number(orderForm.quantity),
            exchange: orderForm.exchange,
            pendingForm: { ...orderForm },
          });
          setCdslAuthUrl(null);
          return;
        }
        toast.error(err.message || "Failed to place order");
      }
    }
  };

  // Retry the pending order after CDSL authorization is complete
  const handleCdslRetry = async () => {
    if (!cdslPending) return;
    const form = cdslPending.pendingForm;
    try {
      const variety = isNseMarketOpen() ? "regular" : "amo";
      await placeOrder({
        tradingsymbol: form.symbol,
        exchange: form.exchange,
        transaction_type: form.txType,
        quantity: Number(form.quantity),
        product: form.product,
        order_type: form.orderType,
        variety,
        price: form.price ? Number(form.price) : undefined,
        trigger_price: form.triggerPrice ? Number(form.triggerPrice) : undefined,
        validity: form.validity,
        validity_ttl: form.validity === "TTL" ? Number(form.ttlMinutes) || 15 : undefined,
        paper_trade: paperMode || (user?.paper_trade_mode ?? false),
      });
      toast.success(`Order placed — ${form.txType} ${form.symbol}`);
      setCdslPending(null);
      setCdslAuthUrl(null);
      setOrderForm(EMPTY_ORDER);
      setSlippageAcked(false);
      getOrders()
        .then((res) => setOrders(res.orders.map(mapOrder)))
        .catch(() => {});
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status !== 401) {
        toast.error(err.message || "Failed to place order after CDSL authorization");
      }
    }
  };

  const handleCancelOrder = async (id: string) => {
    const order = orders.find((o) => o.id === id);
    try {
      await cancelOrder(id, order?.variety ?? "regular");
      toast.success("Order cancelled");
      getOrders()
        .then((res) => setOrders(res.orders.map(mapOrder)))
        .catch(() => {});
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status !== 401) {
        toast.error(err.message || "Failed to cancel order");
      }
    }
  };

  // TR-05 / US-072: Modify order
  const openModify = (o: Order) => {
    setModifyOrder(o);
    setModifyForm({
      quantity: String(o.quantity),
      price: String(o.price || ""),
      triggerPrice: String(o.triggerPrice || ""),
    });
  };

  const handleModifyConfirm = async () => {
    if (!modifyOrder) return;
    try {
      await apiModifyOrder(modifyOrder.id, {
        variety: modifyOrder.variety ?? "regular",
        order_type: modifyOrder.orderType,
        quantity: modifyForm.quantity ? Number(modifyForm.quantity) : undefined,
        price: modifyForm.price ? Number(modifyForm.price) : undefined,
        trigger_price: modifyForm.triggerPrice ? Number(modifyForm.triggerPrice) : undefined,
      });
      toast.success("Order modified");
      setModifyOrder(null);
      getOrders()
        .then((res) => setOrders(res.orders.map(mapOrder)))
        .catch(() => {});
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status !== 401) {
        toast.error(err.message || "Failed to modify order");
      }
    }
  };

  // US-073: GTT delete
  const handleDeleteGtt = async (id: string) => {
    try {
      await deleteGtt(Number(id));
      setGttOrders((prev) => prev.filter((g) => g.id !== id));
      setDeleteGttId(null);
      toast.success("GTT deleted");
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status !== 401) {
        toast.error(err.message || "Failed to delete GTT");
      }
    }
  };

  // GTT place
  const handlePlaceGtt = async () => {
    if (!gttForm.symbol || !gttForm.quantity) return;
    const h = holdings.find((hh) => hh.symbol === gttForm.symbol);
    const lastPrice = (h?.instrumentToken != null && livePrices[h.instrumentToken]?.ltp) || h?.ltp || 0;
    try {
      if (gttForm.gttType === "single") {
        await placeGtt({
          tradingsymbol: gttForm.symbol,
          exchange: h?.exchange ?? "NSE",
          transaction_type: gttForm.txType,
          product: gttForm.product,
          trigger_type: "single",
          last_price: lastPrice,
          quantity: Number(gttForm.quantity),
          trigger_value: gttForm.singleTrigger ? Number(gttForm.singleTrigger) : undefined,
          limit_price: gttForm.singleLimit ? Number(gttForm.singleLimit) : undefined,
        });
      } else {
        await placeGtt({
          tradingsymbol: gttForm.symbol,
          exchange: h?.exchange ?? "NSE",
          transaction_type: gttForm.txType,
          product: gttForm.product,
          trigger_type: "two-leg",
          last_price: lastPrice,
          upper_trigger_value: gttForm.upperTrigger ? Number(gttForm.upperTrigger) : undefined,
          upper_limit_price: gttForm.upperLimit ? Number(gttForm.upperLimit) : undefined,
          upper_quantity: Number(gttForm.quantity),
          lower_trigger_value: gttForm.lowerTrigger ? Number(gttForm.lowerTrigger) : undefined,
          lower_limit_price: gttForm.lowerLimit ? Number(gttForm.lowerLimit) : undefined,
          lower_quantity: Number(gttForm.quantity),
        });
      }
      toast.success("GTT placed");
      setGttForm(EMPTY_GTT);
      getGtts()
        .then((res) => setGttOrders(res.gtts.map(mapGtt)))
        .catch(() => {});
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status !== 401) {
        toast.error(err.message || "Failed to place GTT");
      }
    }
  };

  const openModifyGtt = (g: GTTOrder) => {
    setModifyGtt(g);
    setModifyGttForm({
      quantity: String(g.quantity),
      singleTrigger: g.singleTrigger != null ? String(g.singleTrigger) : "",
      singleLimit: g.singleLimit != null ? String(g.singleLimit) : "",
      upperTrigger: g.upperTrigger != null ? String(g.upperTrigger) : "",
      upperLimit: g.upperLimit != null ? String(g.upperLimit) : "",
      lowerTrigger: g.lowerTrigger != null ? String(g.lowerTrigger) : "",
      lowerLimit: g.lowerLimit != null ? String(g.lowerLimit) : "",
    });
  };

  const handleModifyGttConfirm = async () => {
    if (!modifyGtt) return;
    const h = holdings.find((hh) => hh.symbol === modifyGtt.symbol);
    const lastPrice = (h?.instrumentToken != null && livePrices[h.instrumentToken]?.ltp) || h?.ltp || 0;
    try {
      await apiModifyGtt(Number(modifyGtt.id), {
        tradingsymbol: modifyGtt.symbol,
        exchange: modifyGtt.exchange,
        transaction_type: modifyGtt.transaction,
        product: modifyGtt.product,
        last_price: lastPrice,
        trigger_type: modifyGtt.type,
        ...(modifyGtt.type === "single"
          ? {
              quantity: modifyGttForm.quantity ? Number(modifyGttForm.quantity) : undefined,
              trigger_value: modifyGttForm.singleTrigger ? Number(modifyGttForm.singleTrigger) : undefined,
              limit_price: modifyGttForm.singleLimit ? Number(modifyGttForm.singleLimit) : undefined,
            }
          : {
              upper_trigger_value: modifyGttForm.upperTrigger ? Number(modifyGttForm.upperTrigger) : undefined,
              upper_limit_price: modifyGttForm.upperLimit ? Number(modifyGttForm.upperLimit) : undefined,
              upper_quantity: modifyGttForm.quantity ? Number(modifyGttForm.quantity) : undefined,
              lower_trigger_value: modifyGttForm.lowerTrigger ? Number(modifyGttForm.lowerTrigger) : undefined,
              lower_limit_price: modifyGttForm.lowerLimit ? Number(modifyGttForm.lowerLimit) : undefined,
              lower_quantity: modifyGttForm.quantity ? Number(modifyGttForm.quantity) : undefined,
            }),
      });
      toast.success("GTT modified");
      setModifyGtt(null);
      getGtts()
        .then((res) => setGttOrders(res.gtts.map(mapGtt)))
        .catch(() => {});
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status !== 401) {
        toast.error(err.message || "Failed to modify GTT");
      }
    }
  };

  const STATUS_STYLES: Record<Order["status"], string> = {
    OPEN: "bg-blue-900/30 text-blue-400",
    COMPLETE: "bg-green-900/30 text-green-400",
    REJECTED: "bg-red-900/30 text-red-400",
    CANCELLED: "bg-[#2a2a2a] text-muted-foreground",
  };

  const GTT_STATUS_STYLES: Record<GTTOrder["status"], string> = {
    ACTIVE: "bg-blue-900/30 text-blue-400",
    TRIGGERED: "bg-green-900/30 text-green-400",
    CANCELLED: "bg-[#2a2a2a] text-muted-foreground",
  };

  return (
    <div className="flex h-full">
      {/* Left panel: Order form */}
      <aside className="w-72 shrink-0 border-r border-[#2a2a2a] bg-[#0f0f0f] flex flex-col">
        <div className="px-4 py-3 border-b border-[#2a2a2a]">
          <div className="flex rounded overflow-hidden border border-[#2a2a2a]">
            {(["orders", "gtt"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-1.5 text-sm font-medium transition-colors ${
                  tab === t
                    ? "bg-[#2a2a2a] text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "orders" ? "Order" : "GTT"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {tab === "orders" ? (
            <div className="space-y-3">
              {/* TR-17: Paper trade toggle */}
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-muted-foreground">Paper trade mode</span>
                <button
                  onClick={() => setPaperMode((v) => !v)}
                  className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                    paperMode
                      ? "border-amber-500/50 bg-amber-900/20 text-amber-400"
                      : "border-[#2a2a2a] text-muted-foreground hover:border-[#3a3a3a]"
                  }`}
                >
                  {paperMode ? "PAPER" : "LIVE"}
                </button>
              </div>

              {/* Symbol */}
              <Field label="Symbol" tooltip="The stock you want to buy or sell.">
                <select
                  value={orderForm.symbol}
                  onChange={(e) => {
                    const h = holdings.find((hh) => hh.symbol === e.target.value);
                    const exch = h?.exchange ?? "NSE";
                    setOrderForm((f) => ({
                      ...f,
                      symbol: e.target.value,
                      exchange: exch,
                      // auto-correct product when exchange type changes
                      product: defaultProduct(exch),
                    }));
                  }}
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]"
                >
                  <option value="">Select symbol…</option>
                  {holdings.map((h) => (
                    <option key={h.symbol} value={h.symbol}>
                      {h.symbol} ({h.exchange})
                    </option>
                  ))}
                </select>
              </Field>

              {/* Buy / Sell — no label, same as Kite */}
              <div className="flex rounded overflow-hidden border border-[#2a2a2a]">
                {(["BUY", "SELL"] as TxType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setOf("txType", t)}
                    className={`flex-1 py-1.5 text-sm font-medium transition-colors ${
                      orderForm.txType === t
                        ? t === "BUY"
                          ? "bg-green-700 text-white"
                          : "bg-red-700 text-white"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t === "BUY" ? "Buy" : "Sell"}
                  </button>
                ))}
              </div>

              {/* Product */}
              <Field label="Product" tooltip="Delivery (CNC): hold overnight, no auto square-off. Intraday (MIS): auto-squares off by 3:20 PM. Overnight (NRML): for F&O positions held overnight.">
                <select
                  value={orderForm.product}
                  onChange={(e) => setOf("product", e.target.value as Product)}
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]"
                >
                  {productOptions(orderForm.exchange).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>

              {/* Order type */}
              <Field label="Order" tooltip="Market: execute at best available price instantly. Limit: execute only at your specified price. SL (Stop-Loss Limit): activates at trigger price, then places a limit order. SL-M (Stop-Loss Market): activates at trigger price, then executes at market price.">
                <select
                  value={orderForm.orderType}
                  onChange={(e) => { setOf("orderType", e.target.value as OrderType); setSlippageAcked(false); }}
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]"
                >
                  <option value="MARKET">Market</option>
                  <option value="LIMIT">Limit</option>
                  <option value="SL">SL — Stop-Loss Limit</option>
                  <option value="SL-M">SL-M — Stop-Loss Market</option>
                </select>
              </Field>

              {/* Quantity */}
              <Field label="Qty" tooltip="Number of shares to buy or sell.">
                <input
                  type="number"
                  min={1}
                  value={orderForm.quantity}
                  onChange={(e) => setOf("quantity", e.target.value)}
                  placeholder="0"
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]"
                />
              </Field>

              {/* Qty validation */}
              {qtyError && <Warn color="red">{qtyError}</Warn>}
              {/* CNC oversell — hard block */}
              {oversellError && <Warn color="red">{oversellError}</Warn>}
              {/* MIS/NRML oversell — soft warning */}
              {oversellWarning && <Warn color="amber">{oversellWarning}</Warn>}

              {/* Price (LIMIT / SL) */}
              {needsPrice && (
                <Field label="Price" tooltip="The exact price you want to buy/sell at. Your order waits in the queue until the market reaches this price. Example: LTP is ₹1500, set limit ₹1490 — order fills only when price drops to ₹1490.">
                  <input
                    type="number"
                    min={0}
                    step={0.05}
                    value={orderForm.price}
                    onChange={(e) => setOf("price", e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]"
                  />
                </Field>
              )}

              {/* Price required + 20% deviation */}
              {priceRequiredError && <Warn color="red">{priceRequiredError}</Warn>}
              {deviationWarning && <Warn color="amber">{deviationWarning}</Warn>}

              {/* Trigger price — SL and SL-M only */}
              {needsTrigger && (
                <Field label="Trigger price" tooltip="Your safety net. When LTP falls to this price, Kite automatically places your sell order. For SL: the sell executes at your Limit price below. For SL-M: it executes at whatever market price is available. Example: Bought at ₹1500, set trigger ₹1450 — if price drops to ₹1450 your stop-loss fires.">
                  <input
                    type="number"
                    min={0}
                    step={0.05}
                    value={orderForm.triggerPrice}
                    onChange={(e) => setOf("triggerPrice", e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]"
                  />
                </Field>
              )}

              {/* TR-11: SL validation + trigger required + tick size */}
              {triggerRequiredError && <Warn color="red">{triggerRequiredError}</Warn>}
              {slValidationError && <Warn color="red">{slValidationError}</Warn>}
              {tickSizeError && <Warn color="red">{tickSizeError}</Warn>}

              {/* TR-15: Margin warning */}
              {marginWarning && <Warn color="amber">{marginWarning}</Warn>}

              {/* Validity */}
              <Field label="Validity" tooltip="Day: order is valid till market close at 3:30 PM. IOC (Immediate or Cancel): fills instantly or gets cancelled — no partial fills held. TTL: order expires after the specified number of minutes.">
                <div className="flex rounded overflow-hidden border border-[#2a2a2a]">
                  {([
                    { value: "DAY", label: "Day" },
                    { value: "IOC", label: "IOC" },
                    { value: "TTL", label: "TTL" },
                  ] as { value: Validity; label: string }[]).map((v) => (
                    <button
                      key={v.value}
                      onClick={() => setOf("validity", v.value)}
                      className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                        orderForm.validity === v.value
                          ? "bg-[#2a2a2a] text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
                {/* Validity hint */}
                <p className="text-[10px] text-muted-foreground/50 mt-1">
                  {orderForm.validity === "DAY" && "Valid till market close (3:30 PM IST)"}
                  {orderForm.validity === "IOC" && "Immediate or Cancel — unmatched qty is cancelled instantly"}
                  {orderForm.validity === "TTL" && "Order expires after the specified minutes"}
                </p>
                {/* TTL minutes input */}
                {orderForm.validity === "TTL" && (
                  <div className="flex items-center gap-2 mt-1.5">
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={orderForm.ttlMinutes}
                      onChange={(e) => setOf("ttlMinutes", e.target.value)}
                      className="w-20 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]"
                    />
                    <span className="text-xs text-muted-foreground">minutes</span>
                  </div>
                )}
              </Field>

              <button
                onClick={handlePlaceOrder}
                disabled={!canSubmit}
                className={`w-full py-2.5 rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  orderForm.txType === "BUY"
                    ? "bg-green-700 hover:bg-green-600 text-white"
                    : "bg-red-700 hover:bg-red-600 text-white"
                }`}
              >
                {paperMode && <span className="text-xs mr-1 opacity-75">[PAPER]</span>}
                {orderForm.txType === "BUY" ? "Buy" : "Sell"}{" "}
                {orderForm.symbol || "…"}
              </button>
            </div>
          ) : (
            // GTT form
            <div className="space-y-3">
              <Field label="Symbol" tooltip="The stock to set a Good Till Triggered order on.">
                <select
                  value={gttForm.symbol}
                  onChange={(e) => {
                    const h = holdings.find((hh) => hh.symbol === e.target.value);
                    const exch = h?.exchange ?? "NSE";
                    setGttForm((f) => ({
                      ...f,
                      symbol: e.target.value,
                      product: defaultProduct(exch),
                    }));
                  }}
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]"
                >
                  <option value="">Select symbol…</option>
                  {holdings.map((h) => (
                    <option key={h.symbol} value={h.symbol}>
                      {h.symbol}
                    </option>
                  ))}
                </select>
              </Field>

              {/* Buy / Sell */}
              <div className="flex rounded overflow-hidden border border-[#2a2a2a]">
                {(["BUY", "SELL"] as TxType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setGttForm((f) => ({ ...f, txType: t }))}
                    className={`flex-1 py-1.5 text-sm font-medium transition-colors ${
                      gttForm.txType === t
                        ? t === "BUY"
                          ? "bg-green-700 text-white"
                          : "bg-red-700 text-white"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t === "BUY" ? "Buy" : "Sell"}
                  </button>
                ))}
              </div>

              <Field label="GTT type" tooltip="Single: one trigger fires one order. Two-leg: set a target (upper) trigger and a stop-loss (lower) trigger — whichever fires first cancels the other.">
                <select
                  value={gttForm.gttType}
                  onChange={(e) => setGttForm((f) => ({ ...f, gttType: e.target.value as GttType }))}
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]"
                >
                  <option value="single">Single trigger</option>
                  <option value="two-leg">Two-leg (SL + Target)</option>
                </select>
              </Field>
              <Field label="Product" tooltip="Product type for the order that will be placed when this GTT triggers.">
                <select
                  value={gttForm.product}
                  onChange={(e) => setGttForm((f) => ({ ...f, product: e.target.value as Product }))}
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]"
                >
                  {productOptions(holdings.find((h) => h.symbol === gttForm.symbol)?.exchange ?? "NSE").map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Quantity" tooltip="Number of shares for the order placed when this GTT triggers.">
                <input
                  type="number"
                  min={1}
                  value={gttForm.quantity}
                  onChange={(e) => setGttForm((f) => ({ ...f, quantity: e.target.value }))}
                  placeholder="0"
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]"
                />
              </Field>
              {gttForm.gttType === "single" ? (
                <>
                  <Field label="Trigger price (₹)" tooltip="When LTP touches this price, Kite automatically places a new order on your behalf. Example: Set trigger ₹1800 on a stock at ₹1600 — order fires when price rises to ₹1800.">
                    <input type="number" value={gttForm.singleTrigger} onChange={(e) => setGttForm((f) => ({ ...f, singleTrigger: e.target.value }))} placeholder="0.00" className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]" />
                  </Field>
                  <Field label="Limit price (₹)" tooltip="The price at which the triggered order will execute. Set it slightly below trigger (for buy) or above (for sell) to ensure it fills. Example: Trigger ₹1800, limit ₹1795 — order placed at ₹1795 when triggered.">
                    <input type="number" value={gttForm.singleLimit} onChange={(e) => setGttForm((f) => ({ ...f, singleLimit: e.target.value }))} placeholder="0.00" className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]" />
                  </Field>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground font-medium">Target (upper leg)</p>
                  <Field label="Trigger (₹)" tooltip="Target trigger — GTT fires when LTP rises to or above this price.">
                    <input type="number" value={gttForm.upperTrigger} onChange={(e) => setGttForm((f) => ({ ...f, upperTrigger: e.target.value }))} placeholder="0.00" className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]" />
                  </Field>
                  <Field label="Limit (₹)" tooltip="Limit price for the target leg order.">
                    <input type="number" value={gttForm.upperLimit} onChange={(e) => setGttForm((f) => ({ ...f, upperLimit: e.target.value }))} placeholder="0.00" className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]" />
                  </Field>
                  <p className="text-xs text-muted-foreground font-medium">Stop-loss (lower leg)</p>
                  <Field label="Trigger (₹)" tooltip="Stop-loss trigger — GTT fires when LTP falls to or below this price.">
                    <input type="number" value={gttForm.lowerTrigger} onChange={(e) => setGttForm((f) => ({ ...f, lowerTrigger: e.target.value }))} placeholder="0.00" className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]" />
                  </Field>
                  <Field label="Limit (₹)" tooltip="Limit price for the stop-loss leg order.">
                    <input type="number" value={gttForm.lowerLimit} onChange={(e) => setGttForm((f) => ({ ...f, lowerLimit: e.target.value }))} placeholder="0.00" className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]" />
                  </Field>
                </>
              )}
              <button
                onClick={handlePlaceGtt}
                disabled={!gttForm.symbol || !gttForm.quantity}
                className={`w-full py-2.5 rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors ${
                  gttForm.txType === "BUY"
                    ? "bg-green-700 hover:bg-green-600"
                    : "bg-red-700 hover:bg-red-600"
                }`}
              >
                {gttForm.txType === "BUY" ? "Buy" : "Sell"} GTT — {gttForm.symbol || "…"}
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Right panel: orders list */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-4 py-3 border-b border-[#2a2a2a] bg-[#121212]">
          <h2 className="text-sm font-medium">
            {tab === "orders" ? "Today's Orders" : "Active GTTs"}
          </h2>
        </div>
        <div className="flex-1 overflow-auto">
          {tab === "orders" ? (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#121212] border-b border-[#2a2a2a]">
                <tr>
                  {(["symbol", "type", "status", "time"] as SortKey[]).map((col) => (
                    <th
                      key={col}
                      className="px-3 py-2.5 text-left text-muted-foreground font-medium text-xs cursor-pointer hover:text-foreground capitalize"
                      onClick={() => handleSort(col)}
                    >
                      <span className="flex items-center">
                        {col} <SortIcon col={col} />
                      </span>
                    </th>
                  ))}
                  <th className="px-3 py-2.5 text-left text-muted-foreground font-medium text-xs">Product</th>
                  <th className="px-3 py-2.5 text-right text-muted-foreground font-medium text-xs">Qty</th>
                  <th className="px-3 py-2.5 text-right text-muted-foreground font-medium text-xs">Price</th>
                  <th className="px-3 py-2.5 text-left text-muted-foreground font-medium text-xs">Type</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((o) => (
                  <tr key={o.id} className="border-b border-[#1a1a1a] hover:bg-[#141414] transition-colors">
                    <td className="px-3 py-2.5 font-medium">{o.symbol}</td>
                    <td className={`px-3 py-2.5 font-medium text-xs ${o.type === "BUY" ? "text-green-400" : "text-red-400"}`}>
                      {o.type}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[o.status]}`}>
                        {o.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground font-mono text-xs">{o.time}</td>
                    <td className="px-3 py-2.5 text-muted-foreground text-xs">{o.product}</td>
                    <td className="px-3 py-2.5 text-right">{o.quantity}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">
                      {o.price > 0 ? `₹${o.price.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground text-xs">{o.orderType}</td>
                    <td className="px-3 py-2.5">
                      {o.status === "OPEN" && (
                        <div className="flex items-center gap-1">
                          {/* TR-05: Modify button */}
                          <button
                            onClick={() => openModify(o)}
                            className="p-1 text-muted-foreground hover:text-[#FF6600] transition-colors"
                            title="Modify order"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleCancelOrder(o.id)}
                            className="p-1 text-muted-foreground hover:text-red-400 transition-colors"
                            title="Cancel order"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#121212] border-b border-[#2a2a2a]">
                <tr>
                  <th className="px-3 py-2.5 text-left text-muted-foreground font-medium text-xs">Symbol</th>
                  <th className="px-3 py-2.5 text-left text-muted-foreground font-medium text-xs">B/S</th>
                  <th className="px-3 py-2.5 text-left text-muted-foreground font-medium text-xs">Type</th>
                  <th className="px-3 py-2.5 text-right text-muted-foreground font-medium text-xs">Qty</th>
                  <th className="px-3 py-2.5 text-right text-muted-foreground font-medium text-xs">Trigger ↓</th>
                  <th className="px-3 py-2.5 text-right text-muted-foreground font-medium text-xs">LTP</th>
                  <th className="px-3 py-2.5 text-right text-muted-foreground font-medium text-xs">Limit</th>
                  <th className="px-3 py-2.5 text-left text-muted-foreground font-medium text-xs">Status</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {gttOrders.map((g) => {
                  const h = holdings.find((hh) => hh.symbol === g.symbol);
                  const gLtp = (h?.instrumentToken != null && livePrices[h.instrumentToken]?.ltp) || h?.ltp;
                  return (
                  <tr key={g.id} className="border-b border-[#1a1a1a] hover:bg-[#141414] transition-colors">
                    <td className="px-3 py-2.5 font-medium">
                      <div>{g.symbol}</div>
                      <div className="text-xs text-muted-foreground">{g.exchange}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${
                        g.transaction === "BUY" ? "bg-green-900/30 text-green-400" : "bg-red-900/30 text-red-400"
                      }`}>
                        {g.transaction}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground text-xs capitalize">
                      {g.type === "two-leg" ? "2-leg" : "single"}
                    </td>
                    <td className="px-3 py-2.5 text-right">{g.quantity}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">
                      {g.type === "two-leg" ? (
                        <div>
                          <div className="text-green-400">↑ ₹{g.upperTrigger?.toFixed(2) ?? "—"}</div>
                          <div className="text-red-400">↓ ₹{g.lowerTrigger?.toFixed(2) ?? "—"}</div>
                        </div>
                      ) : (
                        `₹${g.singleTrigger?.toFixed(2) ?? "—"}`
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-muted-foreground">
                      {gLtp != null ? `₹${gLtp.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">
                      {g.type === "two-leg" ? (
                        <div>
                          <div className="text-green-400">₹{g.upperLimit?.toFixed(2) ?? "—"}</div>
                          <div className="text-red-400">₹{g.lowerLimit?.toFixed(2) ?? "—"}</div>
                        </div>
                      ) : (
                        `₹${g.singleLimit?.toFixed(2) ?? "—"}`
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${GTT_STATUS_STYLES[g.status]}`}>
                        {g.status}
                      </span>
                    </td>
                    {/* US-073: GTT modify and delete */}
                    <td className="px-3 py-2.5">
                      {g.status === "ACTIVE" && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openModifyGtt(g)}
                            className="p-1 text-muted-foreground hover:text-[#FF6600] transition-colors"
                            title="Modify GTT"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteGttId(g.id)}
                            className="p-1 text-muted-foreground hover:text-red-400 transition-colors"
                            title="Delete GTT"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* TR-12: MARKET slippage warning modal */}
      {showSlippageWarning && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg w-full max-w-sm">
            <div className="px-5 py-4 border-b border-[#2a2a2a] flex items-center gap-2">
              <Info className="w-4 h-4 text-amber-400" />
              <h2 className="text-base font-semibold">Market Order Slippage</h2>
            </div>
            <div className="px-5 py-4 text-sm text-muted-foreground">
              Market orders execute at the best available price and may result in slippage,
              especially for illiquid instruments or large quantities.
            </div>
            <div className="px-5 py-4 border-t border-[#2a2a2a] flex justify-end gap-3">
              <button
                onClick={() => setShowSlippageWarning(false)}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setSlippageAcked(true);
                  setShowSlippageWarning(false);
                  setShowOrderReview(true);
                }}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded transition-colors"
              >
                I understand, continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TR-03 / TR-14: Order review + charges modal */}
      {showOrderReview && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg w-full max-w-sm">
            <div className="px-5 py-4 border-b border-[#2a2a2a]">
              <h2 className="text-base font-semibold">
                Review Order
                {paperMode && <span className="ml-2 text-xs text-amber-400 bg-amber-900/20 px-1.5 py-0.5 rounded">PAPER</span>}
              </h2>
            </div>
            <div className="px-5 py-4 space-y-2.5 text-sm">
              <ReviewRow label="Symbol" value={`${orderForm.symbol} (${orderForm.exchange})`} />
              <ReviewRow label="Transaction" value={orderForm.txType === "BUY" ? "Buy" : "Sell"} />
              <ReviewRow label="Product" value={productOptions(orderForm.exchange).find((o) => o.value === orderForm.product)?.label ?? orderForm.product} />
              <ReviewRow label="Order" value={orderForm.orderType === "MARKET" ? "Market" : orderForm.orderType === "LIMIT" ? "Limit" : orderForm.orderType} />
              <ReviewRow label="Qty" value={orderForm.quantity} />
              {needsPrice && orderForm.price && (
                <ReviewRow label="Price" value={`₹${orderForm.price}`} />
              )}
              {needsTrigger && orderForm.triggerPrice && (
                <ReviewRow label="Trigger price" value={`₹${orderForm.triggerPrice}`} />
              )}
              <ReviewRow label="Validity" value={orderForm.validity === "DAY" ? "Day" : orderForm.validity === "IOC" ? "IOC" : `TTL — ${orderForm.ttlMinutes} min`} />
            </div>

            {/* TR-14: Estimated charges breakdown */}
            {charges && (
              <div className="px-5 pb-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                  Estimated Charges
                </p>
                <div className="bg-[#0f0f0f] border border-[#2a2a2a] rounded p-3 space-y-1.5 text-xs">
                  <ChargeRow label="Brokerage" value={fmt(charges.brokerage)} />
                  <ChargeRow label="STT" value={fmt(charges.stt)} />
                  <ChargeRow label="Exchange charges" value={fmt(charges.exchCharges)} />
                  <ChargeRow label="GST (18%)" value={fmt(charges.gst)} />
                  <ChargeRow label="SEBI charges" value={fmt(charges.sebi)} />
                  <ChargeRow label="Stamp duty" value={fmt(charges.stampDuty)} />
                  <div className="border-t border-[#2a2a2a] pt-1.5 flex justify-between font-medium">
                    <span>Total charges</span>
                    <span>{fmt(charges.total)}</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  Estimates only. Actual charges determined by Zerodha post-execution.
                </p>
              </div>
            )}

            <div className="px-5 py-4 border-t border-[#2a2a2a] flex justify-end gap-3">
              <button
                onClick={() => setShowOrderReview(false)}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                Edit
              </button>
              <button
                onClick={handleConfirmOrder}
                className={`px-5 py-2 rounded text-sm font-medium text-white transition-colors ${
                  orderForm.txType === "BUY"
                    ? "bg-green-700 hover:bg-green-600"
                    : "bg-red-700 hover:bg-red-600"
                }`}
              >
                Confirm {orderForm.txType}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TR-05 / US-072: Modify order modal */}
      {modifyOrder && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg w-full max-w-sm">
            <div className="px-5 py-4 border-b border-[#2a2a2a]">
              <h2 className="text-base font-semibold">Modify Order — {modifyOrder.symbol}</h2>
            </div>
            <div className="px-5 py-4 space-y-3 text-sm">
              <Field label="Quantity" tooltip="Updated number of shares for this order.">
                <input
                  type="number"
                  min={1}
                  value={modifyForm.quantity}
                  onChange={(e) => setModifyForm((f) => ({ ...f, quantity: e.target.value }))}
                  className="w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]"
                />
              </Field>
              {(modifyOrder.orderType === "LIMIT" || modifyOrder.orderType === "SL") && (
                <Field label="Price (₹)" tooltip="Updated limit price for this order.">
                  <input
                    type="number"
                    min={0}
                    step={0.05}
                    value={modifyForm.price}
                    onChange={(e) => setModifyForm((f) => ({ ...f, price: e.target.value }))}
                    className="w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]"
                  />
                </Field>
              )}
              {(modifyOrder.orderType === "SL" || modifyOrder.orderType === "SL-M") && (
                <Field label="Trigger price (₹)" tooltip="Updated safety net price. When LTP drops to this level, your stop-loss order fires automatically.">
                  <input
                    type="number"
                    min={0}
                    step={0.05}
                    value={modifyForm.triggerPrice}
                    onChange={(e) => setModifyForm((f) => ({ ...f, triggerPrice: e.target.value }))}
                    className="w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]"
                  />
                </Field>
              )}
            </div>
            <div className="px-5 py-4 border-t border-[#2a2a2a] flex justify-end gap-3">
              <button
                onClick={() => setModifyOrder(null)}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={handleModifyConfirm}
                className="px-4 py-2 bg-[#FF6600] hover:bg-[#ff7700] text-white text-sm font-medium rounded transition-colors"
              >
                Confirm Modify
              </button>
            </div>
          </div>
        </div>
      )}

      {/* US-073: GTT modify modal */}
      {modifyGtt && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg w-full max-w-sm">
            <div className="px-5 py-4 border-b border-[#2a2a2a] flex items-center justify-between">
              <h2 className="text-base font-semibold">Modify GTT — {modifyGtt.symbol}</h2>
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                modifyGtt.transaction === "BUY" ? "bg-green-900/30 text-green-400" : "bg-red-900/30 text-red-400"
              }`}>{modifyGtt.transaction}</span>
            </div>
            <div className="px-5 py-4 space-y-3 text-sm">
              <Field label="Quantity" tooltip="Updated number of shares for this GTT.">
                <input
                  type="number" min={1}
                  value={modifyGttForm.quantity}
                  onChange={(e) => setModifyGttForm((f) => ({ ...f, quantity: e.target.value }))}
                  className="w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]"
                />
              </Field>
              {modifyGtt.type === "single" ? (
                <>
                  <Field label="Trigger price (₹)" tooltip="GTT fires when LTP touches this price.">
                    <input type="number" step={0.05} value={modifyGttForm.singleTrigger}
                      onChange={(e) => setModifyGttForm((f) => ({ ...f, singleTrigger: e.target.value }))}
                      className="w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]" />
                  </Field>
                  <Field label="Limit price (₹)" tooltip="The limit price of the order placed when GTT fires.">
                    <input type="number" step={0.05} value={modifyGttForm.singleLimit}
                      onChange={(e) => setModifyGttForm((f) => ({ ...f, singleLimit: e.target.value }))}
                      className="w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]" />
                  </Field>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground font-medium">Target (upper leg)</p>
                  <Field label="Trigger (₹)" tooltip="GTT fires when LTP rises to this price.">
                    <input type="number" step={0.05} value={modifyGttForm.upperTrigger}
                      onChange={(e) => setModifyGttForm((f) => ({ ...f, upperTrigger: e.target.value }))}
                      className="w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]" />
                  </Field>
                  <Field label="Limit (₹)" tooltip="Limit price for the target leg.">
                    <input type="number" step={0.05} value={modifyGttForm.upperLimit}
                      onChange={(e) => setModifyGttForm((f) => ({ ...f, upperLimit: e.target.value }))}
                      className="w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]" />
                  </Field>
                  <p className="text-xs text-muted-foreground font-medium">Stop-loss (lower leg)</p>
                  <Field label="Trigger (₹)" tooltip="GTT fires when LTP falls to this price.">
                    <input type="number" step={0.05} value={modifyGttForm.lowerTrigger}
                      onChange={(e) => setModifyGttForm((f) => ({ ...f, lowerTrigger: e.target.value }))}
                      className="w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]" />
                  </Field>
                  <Field label="Limit (₹)" tooltip="Limit price for the stop-loss leg.">
                    <input type="number" step={0.05} value={modifyGttForm.lowerLimit}
                      onChange={(e) => setModifyGttForm((f) => ({ ...f, lowerLimit: e.target.value }))}
                      className="w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]" />
                  </Field>
                </>
              )}
            </div>
            <div className="px-5 py-4 border-t border-[#2a2a2a] flex justify-end gap-3">
              <button
                onClick={() => setModifyGtt(null)}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={handleModifyGttConfirm}
                className="px-4 py-2 bg-[#FF6600] hover:bg-[#ff7700] text-white text-sm font-medium rounded transition-colors"
              >
                Confirm Modify
              </button>
            </div>
          </div>
        </div>
      )}

      {/* US-073: GTT delete confirmation */}
      {deleteGttId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg w-full max-w-sm">
            <div className="px-5 py-4 border-b border-[#2a2a2a] flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <h2 className="text-base font-semibold">Delete GTT</h2>
            </div>
            <div className="px-5 py-4 text-sm text-muted-foreground">
              Are you sure you want to delete this GTT order? This action cannot be undone.
            </div>
            <div className="px-5 py-4 border-t border-[#2a2a2a] flex justify-end gap-3">
              <button
                onClick={() => setDeleteGttId(null)}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteGtt(deleteGttId)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded transition-colors"
              >
                Delete GTT
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CDSL / eDIS authorization modal */}
      {cdslPending && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg w-full max-w-md">
            <div className="px-5 py-4 border-b border-[#2a2a2a] flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <h2 className="text-base font-semibold">CDSL Authorization Required</h2>
            </div>

            <div className="px-5 py-4 space-y-3 text-sm text-muted-foreground">
              <p>
                To sell delivery (CNC) holdings, CDSL requires you to authorize the transaction
                via their T-PIN portal. This is a one-time authorization per trading day.
              </p>
              <div className="bg-[#0f0f0f] border border-[#2a2a2a] rounded p-3 space-y-1 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Symbol</span>
                  <span className="text-foreground">{cdslPending.pendingForm.symbol}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Quantity</span>
                  <span className="text-foreground">{cdslPending.qty}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Exchange</span>
                  <span className="text-foreground">{cdslPending.exchange}</span>
                </div>
                {cdslPending.isin && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ISIN</span>
                    <span className="text-foreground">{cdslPending.isin}</span>
                  </div>
                )}
              </div>

              <div className="bg-blue-900/10 border border-blue-500/20 rounded p-3 text-xs text-blue-300 space-y-1">
                <p className="font-medium text-blue-200">Steps to authorize:</p>
                <ol className="list-decimal list-inside space-y-0.5">
                  <li>Click &ldquo;Open CDSL Portal&rdquo; — a new tab opens on Zerodha&apos;s eDIS page</li>
                  <li>Enter your CDSL T-PIN or generate an OTP</li>
                  <li>Confirm authorization for {cdslPending.pendingForm.symbol}</li>
                  <li>Return here and click &ldquo;Retry Sell Order&rdquo;</li>
                </ol>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-[#2a2a2a] flex flex-col gap-2">
              <button
                onClick={() => openCdslForm(cdslPending.isin, cdslPending.qty, cdslPending.exchange)}
                disabled={!cdslPending.isin}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                {cdslAuthUrl ? "Re-open CDSL Portal" : "Open CDSL Portal"}
              </button>
              {!cdslPending.isin && (
                <p className="text-xs text-amber-400 text-center">
                  ISIN not available — please visit the{" "}
                  <a
                    href="https://kite.zerodha.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-amber-300"
                  >
                    Kite Web portal
                  </a>{" "}
                  to authorize this holding.
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { setCdslPending(null); setCdslAuthUrl(null); }}
                  className="flex-1 px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-[#2a2a2a] rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCdslRetry}
                  className="flex-1 px-4 py-2 bg-red-700 hover:bg-red-600 text-white text-sm font-medium rounded transition-colors"
                >
                  Retry Sell Order
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, tooltip, children }: { label: string; tooltip?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <label className="text-xs text-muted-foreground">{label}</label>
        {tooltip && (
          <span title={tooltip} className="inline-flex cursor-help">
            <Info className="w-3 h-3 text-muted-foreground/40 hover:text-muted-foreground flex-shrink-0" />
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function ChargeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function Warn({ color, children }: { color: "red" | "amber"; children: React.ReactNode }) {
  const cls = color === "red"
    ? "bg-red-900/20 border-red-500/30 text-red-400"
    : "bg-amber-900/20 border-amber-500/30 text-amber-400";
  return (
    <div className={`flex items-start gap-1.5 border rounded px-2 py-2 ${cls}`}>
      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <p className="text-xs">{children}</p>
    </div>
  );
}
