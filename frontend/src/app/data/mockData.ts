// Mock data for StockPilot application

export interface Holding {
  symbol: string;
  exchange: string;
  isin?: string;              // ISIN for CDSL eDIS authorization (populated from Kite API)
  instrumentToken?: number;   // undefined in mock data; real token from Kite API
  quantity: number;
  t1Quantity: number; // PRD PD-08: T+1 settlement quantity
  avgPrice: number;
  ltp: number;
  dayChange: number;
  dayChangePercent: number;
  pnl: number;
  pnlPercent: number;
  currentValue: number;
  investedValue: number;
  kpis?: {
    dailyRSI?: number;
    rsiOverbought?: boolean;
    // PRD KP-11: title-case values — "Buy Signal" | "Sell Signal" | "Hold"
    bbPosition?: "Buy Signal" | "Sell Signal" | "Hold";
    peRatio?: number;
    from52WeekHigh?: number;
    eps?: number;
  };
}

export interface Position {
  symbol: string;
  exchange: string;
  product: string;
  quantity: number;
  avgPrice: number;
  ltp: number;
  unrealisedPnl: number;
  m2mPnl: number;
  instrumentToken?: number;
}

export interface Order {
  id: string;
  symbol: string;
  exchange: string;                                          // API_SPEC GET /orders
  variety: "regular" | "co" | "amo" | "iceberg" | "auction"; // required for PUT/DELETE per API_SPEC
  type: "BUY" | "SELL";
  product: "CNC" | "MIS" | "NRML";
  quantity: number;
  price: number;
  orderType: "MARKET" | "LIMIT" | "SL" | "SL-M";
  validity: "DAY" | "IOC" | "TTL";                          // PRD §5.4
  status: "OPEN" | "COMPLETE" | "REJECTED" | "CANCELLED";
  time: string;
  statusMessage?: string;
  triggerPrice?: number;
  filledQuantity?: number;
  averagePrice?: number;
}

export interface GTTOrder {
  id: string;
  symbol: string;
  exchange: string;
  type: "single" | "two-leg";
  transaction: "BUY" | "SELL";
  product: "CNC" | "MIS" | "NRML";
  quantity: number;
  upperTrigger?: number;
  upperLimit?: number;
  lowerTrigger?: number;
  lowerLimit?: number;
  singleTrigger?: number;
  singleLimit?: number;
  status: "ACTIVE" | "TRIGGERED" | "CANCELLED";
}

// M-05: Action type naming aligned with PRD data model
// TR-17: PAPER_TRADE added — simulated orders are also logged to the audit trail
export interface AuditEntry {
  id: string;
  timestamp: string;
  action: "PLACE_ORDER" | "MODIFY_ORDER" | "CANCEL_ORDER" | "PLACE_GTT" | "MODIFY_GTT" | "DELETE_GTT" | "PAPER_TRADE";
  symbol: string;
  exchange: string;
  outcome: "SUCCESS" | "FAILURE";
  kiteOrderId?: string;
  requestId: string;
  orderParams: Record<string, unknown>;
  errorMessage?: string;
}

export interface KPI {
  id: string;
  name: string;
  formula: string;
  returnType: "SCALAR" | "BOOLEAN" | "CATEGORICAL";
  description?: string;
  active: boolean;
  createdAt: string;
}

export interface Margin {
  available: number;
  used: number;
  total: number;
}

export const mockMargin: Margin = {
  available: 85000,
  used: 15000,
  total: 100000,
};

// Mock XIRR — null when no purchase history in StockPilot (PD-04, API_SPEC)
export const mockXirr: number | null = 18.4;

export const mockHoldings: Holding[] = [
  {
    symbol: "ABSLAMC",
    exchange: "NSE",
    quantity: 20,
    t1Quantity: 0,
    avgPrice: 445.20,
    ltp: 468.90,
    dayChange: 5.60,
    dayChangePercent: 1.2,
    pnl: 474.00,
    pnlPercent: 5.32,
    currentValue: 9378.00,
    investedValue: 8904.00,
    kpis: {
      dailyRSI: 58.3,
      rsiOverbought: false,
      bbPosition: "Hold",
      peRatio: 32.5,
      from52WeekHigh: -12.3,
      eps: 14.42,
    },
  },
  {
    symbol: "AFFLE",
    exchange: "NSE",
    quantity: 15,
    t1Quantity: 0,
    avgPrice: 1123.40,
    ltp: 1089.00,
    dayChange: -8.75,
    dayChangePercent: -0.8,
    pnl: -516.00,
    pnlPercent: -3.07,
    currentValue: 16335.00,
    investedValue: 16851.00,
    kpis: {
      dailyRSI: 42.1,
      rsiOverbought: false,
      bbPosition: "Hold",
      peRatio: 28.7,
      from52WeekHigh: -35.8,
      eps: 37.92,
    },
  },
  {
    symbol: "ASTRAL",
    exchange: "NSE",
    quantity: 25,
    t1Quantity: 0,
    avgPrice: 689.50,
    ltp: 712.30,
    dayChange: 6.40,
    dayChangePercent: 0.91,
    pnl: 570.00,
    pnlPercent: 3.31,
    currentValue: 17807.50,
    investedValue: 17237.50,
    kpis: {
      dailyRSI: 61.2,
      rsiOverbought: false,
      bbPosition: "Hold",
      peRatio: 45.3,
      from52WeekHigh: -8.4,
      eps: 15.72,
    },
  },
  {
    symbol: "HDFCBANK",
    exchange: "NSE",
    quantity: 50,
    t1Quantity: 5,
    avgPrice: 1620.00,
    ltp: 1698.45,
    dayChange: 6.78,
    dayChangePercent: 0.4,
    pnl: 3922.50,
    pnlPercent: 4.84,
    currentValue: 84922.50,
    investedValue: 81000.00,
    kpis: {
      dailyRSI: 45.8,
      rsiOverbought: false,
      bbPosition: "Buy Signal",
      peRatio: 21.2,
      from52WeekHigh: -18.7,
      eps: 80.12,
    },
  },
  {
    symbol: "INFY",
    exchange: "BSE",
    quantity: 110,
    t1Quantity: 0,
    avgPrice: 1493.64,
    ltp: 1290.35,
    dayChange: 14.05,
    dayChangePercent: 1.1,
    pnl: -22362.40,
    pnlPercent: -13.60,
    currentValue: 141938.50,
    investedValue: 164300.40,
    kpis: {
      dailyRSI: 52.1,
      rsiOverbought: false,
      bbPosition: "Hold",
      peRatio: 28.4,
      from52WeekHigh: -33.9,
      eps: 45.42,
    },
  },
  {
    symbol: "ITC",
    exchange: "NSE",
    quantity: 200,
    t1Quantity: 0,
    avgPrice: 388.00,
    ltp: 451.20,
    dayChange: 0.90,
    dayChangePercent: 0.2,
    pnl: 12640.00,
    pnlPercent: 16.29,
    currentValue: 90240.00,
    investedValue: 77600.00,
    kpis: {
      dailyRSI: 71.4,
      rsiOverbought: true,
      bbPosition: "Sell Signal",
      peRatio: 29.1,
      from52WeekHigh: -2.1,
      eps: 15.51,
    },
  },
  {
    symbol: "LT",
    exchange: "NSE",
    quantity: 12,
    t1Quantity: 0,
    avgPrice: 3433.00,
    ltp: 4298.00,
    dayChange: 38.70,
    dayChangePercent: 0.91,
    pnl: 10380.00,
    pnlPercent: 25.19,
    currentValue: 51576.00,
    investedValue: 41196.00,
    kpis: {
      dailyRSI: 68.5,
      rsiOverbought: false,
      bbPosition: "Hold",
      peRatio: 38.2,
      from52WeekHigh: -5.3,
      eps: 112.51,
    },
  },
  {
    symbol: "TATASTEEL",
    exchange: "NSE",
    quantity: 80,
    t1Quantity: 0,
    avgPrice: 145.30,
    ltp: 158.90,
    dayChange: -1.20,
    dayChangePercent: -0.75,
    pnl: 1088.00,
    pnlPercent: 9.36,
    currentValue: 12712.00,
    investedValue: 11624.00,
    kpis: {
      dailyRSI: 55.7,
      rsiOverbought: false,
      bbPosition: "Hold",
      peRatio: 18.5,
      from52WeekHigh: -22.4,
      eps: 8.59,
    },
  },
];

// PD-02: Intraday positions (MIS and NRML) — shown separately from holdings
export const mockPositions: Position[] = [
  {
    symbol: "INFY",
    exchange: "NSE",
    product: "MIS",
    quantity: 10,
    avgPrice: 1285.00,
    ltp: 1290.35,
    unrealisedPnl: 53.50,
    m2mPnl: 53.50,
  },
  {
    symbol: "TATASTEEL",
    exchange: "NSE",
    product: "MIS",
    quantity: -20,
    avgPrice: 160.50,
    ltp: 158.90,
    unrealisedPnl: 32.00,
    m2mPnl: 32.00,
  },
];

export const mockOrders: Order[] = [
  {
    id: "231228001",
    symbol: "HDFCBANK",
    exchange: "NSE",
    variety: "regular",
    type: "BUY",
    product: "CNC",
    quantity: 5,
    price: 1698.00,
    orderType: "LIMIT",
    validity: "DAY",
    status: "OPEN",
    time: "11:23:45",
  },
  {
    id: "231228002",
    symbol: "ITC",
    exchange: "NSE",
    variety: "regular",
    type: "SELL",
    product: "CNC",
    quantity: 50,
    price: 451.15,
    orderType: "MARKET",
    validity: "DAY",
    status: "COMPLETE",
    time: "11:47:22",
    statusMessage: "filled",
    filledQuantity: 50,
    averagePrice: 451.15,
  },
  {
    id: "231228003",
    symbol: "INFY",
    exchange: "NSE",
    variety: "regular",
    type: "BUY",
    product: "MIS",
    quantity: 20,
    price: 1285.00,
    orderType: "LIMIT",
    validity: "DAY",
    status: "REJECTED",
    time: "11:45:03",
    statusMessage: "Insufficient funds",
  },
];

export const mockGTTOrders: GTTOrder[] = [
  {
    id: "gtt001",
    symbol: "ABSLAMC",
    exchange: "NSE",
    type: "two-leg",
    transaction: "SELL",
    product: "CNC",
    quantity: 20,
    upperTrigger: 510,
    upperLimit: 508,
    lowerTrigger: 420,
    lowerLimit: 418,
    status: "ACTIVE",
  },
  {
    id: "gtt002",
    symbol: "ASTRAL",
    exchange: "NSE",
    type: "single",
    transaction: "SELL",
    product: "CNC",
    quantity: 25,
    singleTrigger: 760,
    singleLimit: 758,
    status: "ACTIVE",
  },
];

// M-05: Updated to PLACE_ORDER / MODIFY_ORDER / CANCEL_ORDER / PLACE_GTT / MODIFY_GTT / DELETE_GTT
export const mockAuditEntries: AuditEntry[] = [
  {
    id: "audit001",
    timestamp: "2026-02-28 11:47:22",
    action: "PLACE_ORDER",
    symbol: "ITC",
    exchange: "NSE",
    outcome: "SUCCESS",
    kiteOrderId: "123456789",
    requestId: "req_8f3a1c9d",
    orderParams: {
      tradingsymbol: "ITC",
      exchange: "NSE",
      transaction_type: "SELL",
      quantity: 50,
      order_type: "MARKET",
      product: "CNC",
      validity: "DAY",
    },
  },
  {
    id: "audit002",
    timestamp: "2026-02-28 11:45:03",
    action: "PLACE_ORDER",
    symbol: "INFY",
    exchange: "NSE",
    outcome: "FAILURE",
    requestId: "req_4b2e8a1f",
    orderParams: {
      tradingsymbol: "INFY",
      exchange: "NSE",
      transaction_type: "BUY",
      quantity: 10,
      order_type: "LIMIT",
      price: 1290.00,
      product: "CNC",
      validity: "DAY",
    },
    errorMessage: "Insufficient funds",
  },
  {
    id: "audit003",
    timestamp: "2026-02-27 15:08:41",
    action: "PLACE_GTT",
    symbol: "ABSLAMC",
    exchange: "NSE",
    outcome: "SUCCESS",
    kiteOrderId: "gtt001",
    requestId: "req_7c4b2a9e",
    orderParams: {
      tradingsymbol: "ABSLAMC",
      exchange: "NSE",
      transaction_type: "SELL",
      quantity: 20,
      trigger_values: [510, 420],
    },
  },
  {
    id: "audit004",
    timestamp: "2026-02-27 14:52:19",
    action: "MODIFY_ORDER",
    symbol: "HDFCBANK",
    exchange: "NSE",
    outcome: "SUCCESS",
    kiteOrderId: "231228001",
    requestId: "req_3a8d1f4c",
    orderParams: {
      order_id: "231228001",
      quantity: 5,
      price: 1698.00,
      order_type: "LIMIT",
    },
  },
  {
    id: "audit005",
    timestamp: "2026-02-26 10:31:55",
    action: "CANCEL_ORDER",
    symbol: "HDFCBANK",
    exchange: "NSE",
    outcome: "SUCCESS",
    kiteOrderId: "231226001",
    requestId: "req_5c9d2e1b",
    orderParams: {
      order_id: "231226001",
    },
  },
  {
    id: "audit006",
    timestamp: "2026-02-25 09:48:10",
    action: "DELETE_GTT",
    symbol: "ASTRAL",
    exchange: "NSE",
    outcome: "SUCCESS",
    requestId: "req_2a7f4c8d",
    orderParams: {
      trigger_id: "gtt_old_001",
    },
  },
  {
    // TR-17: PAPER_TRADE example — simulated order, never sent to Kite
    id: "audit007",
    timestamp: "2026-02-24 10:15:33",
    action: "PAPER_TRADE",
    symbol: "TATASTEEL",
    exchange: "NSE",
    outcome: "SUCCESS",
    kiteOrderId: "PAPER-20260224-001",
    requestId: "req_1d6c9f2a",
    orderParams: {
      tradingsymbol: "TATASTEEL",
      exchange: "NSE",
      transaction_type: "BUY",
      quantity: 10,
      order_type: "LIMIT",
      price: 155.00,
      product: "CNC",
      validity: "DAY",
      paper_trade: true,
    },
  },
];

export const mockKPIs: KPI[] = [
  {
    id: "kpi001",
    name: "Daily RSI",
    formula: "RSI(close, 14)",
    returnType: "SCALAR",
    description: "14-period RSI on daily closes",
    active: true,
    createdAt: "2026-02-15",
  },
  {
    id: "kpi002",
    name: "RSI Overbought",
    formula: "RSI(close, 14) > 70",
    returnType: "BOOLEAN",
    description: "True when RSI is above 70",
    active: true,
    createdAt: "2026-02-15",
  },
  {
    id: "kpi003",
    name: "BB Position",
    // PRD KP-11: title-case values
    formula: 'IF(close > BB_UPPER(close,20,2), "Sell Signal", IF(close < BB_LOWER(close,20,2), "Buy Signal", "Hold"))',
    returnType: "CATEGORICAL",
    description: "Bollinger Band position signal",
    active: true,
    createdAt: "2026-02-16",
  },
  {
    id: "kpi004",
    name: "P/E Ratio",
    formula: "FUNDAMENTAL(pe)",
    returnType: "SCALAR",
    description: "Price to Earnings ratio",
    active: true,
    createdAt: "2026-02-16",
  },
  {
    id: "kpi005",
    name: "% from 52W High",
    formula: "PCT_FROM_52W_HIGH",
    returnType: "SCALAR",
    description: "Percentage change from 52-week high",
    active: true,
    createdAt: "2026-02-17",
  },
  {
    id: "kpi006",
    name: "EPS",
    formula: "FUNDAMENTAL(eps)",
    returnType: "SCALAR",
    description: "Earnings Per Share",
    active: true,
    createdAt: "2026-02-17",
  },
];
