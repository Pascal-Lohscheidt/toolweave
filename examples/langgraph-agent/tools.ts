/**
 * The demo capability: a small outdoor-shop backend behind ten toolweave tools.
 * The agent composes them in ONE typed TypeScript program instead of a
 * round-trip per call.
 *
 * The tool set deliberately exercises the whole schema surface: enums,
 * defaults, optionals, nested objects, records, union outputs, a tool that
 * throws (unknown product id), and a mutating tool (createOrder).
 */
import { z } from 'zod';
import { createRuntime, defineTool } from 'toolweave';

// ---------------------------------------------------------------------------
// In-memory data
// ---------------------------------------------------------------------------

interface Product {
  id: string;
  name: string;
  category: 'outdoor' | 'apparel' | 'electronics' | 'nutrition';
  price: number; // EUR
  weightKg: number;
  tags: string[];
  description: string;
}

const catalog: Product[] = [
  {
    id: 'p1',
    name: 'Trail Backpack 30L',
    category: 'outdoor',
    price: 89,
    weightKg: 1.1,
    tags: ['hiking', 'bestseller'],
    description: 'Lightweight 30L pack with rain cover.',
  },
  {
    id: 'p2',
    name: 'Titanium Mug',
    category: 'outdoor',
    price: 24,
    weightKg: 0.12,
    tags: ['camping', 'ultralight'],
    description: 'Single-wall titanium mug, 450ml.',
  },
  {
    id: 'p3',
    name: 'Merino Hoodie',
    category: 'apparel',
    price: 120,
    weightKg: 0.4,
    tags: ['merino', 'bestseller'],
    description: 'Midweight merino hoodie for shoulder seasons.',
  },
  {
    id: 'p4',
    name: 'Headlamp Pro',
    category: 'electronics',
    price: 45,
    weightKg: 0.09,
    tags: ['hiking', 'night'],
    description: '600-lumen rechargeable headlamp, IPX7.',
  },
  {
    id: 'p5',
    name: 'Rain Shell',
    category: 'apparel',
    price: 99,
    weightKg: 0.3,
    tags: ['rain', 'packable'],
    description: '2.5-layer packable rain jacket.',
  },
  {
    id: 'p6',
    name: 'Trekking Poles',
    category: 'outdoor',
    price: 59,
    weightKg: 0.5,
    tags: ['hiking'],
    description: 'Carbon telescopic poles, pair.',
  },
  {
    id: 'p7',
    name: 'GPS Watch Terra',
    category: 'electronics',
    price: 249,
    weightKg: 0.06,
    tags: ['navigation', 'bestseller'],
    description: 'Multi-band GPS watch, 40h battery.',
  },
  {
    id: 'p8',
    name: 'Energy Bar Box (12)',
    category: 'nutrition',
    price: 21,
    weightKg: 0.7,
    tags: ['snack'],
    description: 'A dozen oat-date energy bars.',
  },
  {
    id: 'p9',
    name: 'Electrolyte Mix',
    category: 'nutrition',
    price: 14,
    weightKg: 0.3,
    tags: ['hydration'],
    description: 'Citrus electrolyte drink mix, 20 servings.',
  },
  {
    id: 'p10',
    name: 'Down Jacket 700',
    category: 'apparel',
    price: 189,
    weightKg: 0.45,
    tags: ['insulation', 'packable'],
    description: '700-fill down jacket with stuff sack.',
  },
  {
    id: 'p11',
    name: 'Camp Stove Mini',
    category: 'outdoor',
    price: 39,
    weightKg: 0.11,
    tags: ['camping', 'ultralight'],
    description: 'Pocket-size canister stove, 3000W.',
  },
  {
    id: 'p12',
    name: 'Solar Charger 20W',
    category: 'electronics',
    price: 65,
    weightKg: 0.55,
    tags: ['camping', 'power'],
    description: 'Foldable 20W solar panel with dual USB.',
  },
];

const inventory = new Map<string, Record<string, number>>([
  ['p1', { berlin: 3, munich: 0 }],
  ['p2', { berlin: 0, munich: 0 }],
  ['p3', { berlin: 8, munich: 4 }],
  ['p4', { berlin: 5, munich: 2 }],
  ['p5', { berlin: 0, munich: 0 }],
  ['p6', { berlin: 2, munich: 3 }],
  ['p7', { berlin: 1, munich: 1 }],
  ['p8', { berlin: 40, munich: 25 }],
  ['p9', { berlin: 0, munich: 18 }],
  ['p10', { berlin: 6, munich: 0 }],
  ['p11', { berlin: 9, munich: 7 }],
  ['p12', { berlin: 0, munich: 2 }],
]);

const reviews = new Map<string, Array<{ author: string; rating: number; text: string }>>([
  [
    'p1',
    [
      { author: 'anna', rating: 5, text: 'Carried it across the Alps, zero complaints.' },
      { author: 'jonas', rating: 4, text: 'Great pack, hip belt could be softer.' },
    ],
  ],
  ['p3', [{ author: 'mira', rating: 5, text: 'Warm, no itch, wear it daily.' }]],
  [
    'p4',
    [
      { author: 'tom', rating: 4, text: 'Bright and light.' },
      { author: 'lea', rating: 2, text: 'Battery indicator is confusing.' },
      { author: 'sam', rating: 5, text: 'Survived a rainstorm, still perfect.' },
    ],
  ],
  ['p7', [{ author: 'nils', rating: 5, text: 'Locks GPS in seconds, battery claim holds.' }]],
  ['p8', [{ author: 'anna', rating: 3, text: 'Tasty but a bit dry.' }]],
  [
    'p10',
    [
      { author: 'kim', rating: 5, text: 'Unreasonably warm for the weight.' },
      { author: 'jonas', rating: 4, text: 'Packs tiny. Zipper feels delicate.' },
    ],
  ],
]);

const customers = [
  {
    id: 'c1',
    name: 'Anna Keller',
    email: 'anna@example.com',
    tier: 'gold' as const,
    address: { city: 'Berlin', country: 'DE' as const },
  },
  {
    id: 'c2',
    name: 'Jonas Weber',
    email: 'jonas@example.com',
    tier: 'standard' as const,
    address: { city: 'Vienna', country: 'AT' as const },
  },
  {
    id: 'c3',
    name: 'Mira Sato',
    email: 'mira@example.com',
    tier: 'standard' as const,
    address: { city: 'Zurich', country: 'CH' as const },
  },
];

interface Order {
  orderId: string;
  customerId: string;
  status: 'pending' | 'shipped' | 'delivered' | 'cancelled';
  items: Array<{ productId: string; quantity: number; unitPrice: number }>;
  total: number;
}

const orders: Order[] = [
  {
    orderId: 'o100',
    customerId: 'c1',
    status: 'delivered',
    items: [
      { productId: 'p1', quantity: 1, unitPrice: 89 },
      { productId: 'p8', quantity: 2, unitPrice: 21 },
    ],
    total: 131,
  },
  {
    orderId: 'o101',
    customerId: 'c1',
    status: 'shipped',
    items: [{ productId: 'p4', quantity: 1, unitPrice: 45 }],
    total: 45,
  },
  {
    orderId: 'o102',
    customerId: 'c2',
    status: 'pending',
    items: [{ productId: 'p10', quantity: 1, unitPrice: 189 }],
    total: 189,
  },
];

const discountCodes = new Map<string, { percent: number; expired: boolean }>([
  ['SUMMER10', { percent: 10, expired: false }],
  ['GOLD15', { percent: 15, expired: false }],
  ['WINTER20', { percent: 20, expired: true }],
]);

// EUR-based exchange rates.
const fxRates = { EUR: 1, USD: 1.08, GBP: 0.85, CHF: 0.94 };

const shipping = {
  base: { DE: 4, AT: 6, CH: 9, FR: 7, NL: 6 },
  perKg: 1.5,
  express: { multiplier: 2.2, etaDays: 1 },
  standardEtaDays: { DE: 2, AT: 3, CH: 5, FR: 4, NL: 3 },
};

let nextOrderId = 103;

function requireProduct(id: string): Product {
  const product = catalog.find((p) => p.id === id);
  if (!product) throw new Error(`Unknown product id: ${id}`);
  return product;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const productSummary = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  price: z.number().describe('Price in EUR'),
});

const searchProducts = defineTool({
  name: 'searchProducts',
  description: 'Search the product catalog. All filters are optional and combined with AND.',
  input: z.object({
    query: z.string().optional().describe('Substring match on name and description'),
    category: z.enum(['outdoor', 'apparel', 'electronics', 'nutrition']).optional(),
    tag: z.string().optional(),
    maxPrice: z.number().optional().describe('Maximum price in EUR'),
    sortBy: z.enum(['price', 'name']).default('price'),
    limit: z.number().int().positive().default(10),
  }),
  output: z.array(productSummary),
  impl: async ({ query, category, tag, maxPrice, sortBy, limit }) => {
    const q = query?.toLowerCase();
    return catalog
      .filter(
        (p) => !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q),
      )
      .filter((p) => !category || p.category === category)
      .filter((p) => !tag || p.tags.includes(tag))
      .filter((p) => maxPrice === undefined || p.price <= maxPrice)
      .sort((a, b) => (sortBy === 'price' ? a.price - b.price : a.name.localeCompare(b.name)))
      .slice(0, limit);
  },
});

const getProduct = defineTool({
  name: 'getProduct',
  description: 'Get full details for one product. Throws if the id is unknown.',
  input: z.object({ id: z.string() }),
  output: z.object({
    id: z.string(),
    name: z.string(),
    category: z.enum(['outdoor', 'apparel', 'electronics', 'nutrition']),
    price: z.number().describe('Price in EUR'),
    weightKg: z.number(),
    tags: z.array(z.string()),
    description: z.string(),
  }),
  impl: async ({ id }) => requireProduct(id),
});

const getInventory = defineTool({
  name: 'getInventory',
  description: 'Units in stock for a product, total and per warehouse',
  input: z.object({ id: z.string() }),
  output: z.object({
    total: z.number(),
    byWarehouse: z.record(z.string(), z.number()),
  }),
  impl: async ({ id }) => {
    requireProduct(id);
    const byWarehouse = inventory.get(id) ?? {};
    return {
      total: Object.values(byWarehouse).reduce((sum, n) => sum + n, 0),
      byWarehouse,
    };
  },
});

const getReviews = defineTool({
  name: 'getReviews',
  description: 'Customer reviews for a product (may be empty)',
  input: z.object({
    productId: z.string(),
    minRating: z.number().int().min(1).max(5).optional(),
  }),
  output: z.array(z.object({ author: z.string(), rating: z.number(), text: z.string() })),
  impl: async ({ productId, minRating }) =>
    (reviews.get(productId) ?? []).filter((r) => minRating === undefined || r.rating >= minRating),
});

const getCustomer = defineTool({
  name: 'getCustomer',
  description: 'Look up a customer by email. Throws if no customer matches.',
  input: z.object({ email: z.string() }),
  output: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    tier: z.enum(['standard', 'gold']),
    address: z.object({ city: z.string(), country: z.enum(['DE', 'AT', 'CH', 'FR', 'NL']) }),
  }),
  impl: async ({ email }) => {
    const customer = customers.find((c) => c.email === email);
    if (!customer) throw new Error(`No customer with email ${email}`);
    return customer;
  },
});

const listOrders = defineTool({
  name: 'listOrders',
  description: 'List orders of a customer, optionally filtered by status',
  input: z.object({
    customerId: z.string(),
    status: z.enum(['pending', 'shipped', 'delivered', 'cancelled']).optional(),
  }),
  output: z.array(
    z.object({
      orderId: z.string(),
      status: z.enum(['pending', 'shipped', 'delivered', 'cancelled']),
      items: z.array(
        z.object({ productId: z.string(), quantity: z.number(), unitPrice: z.number() }),
      ),
      total: z.number().describe('Order total in EUR'),
    }),
  ),
  impl: async ({ customerId, status }) =>
    orders.filter((o) => o.customerId === customerId).filter((o) => !status || o.status === status),
});

const createOrder = defineTool({
  name: 'createOrder',
  description:
    'Place a new order. Fails if any item exceeds total stock. Stock is decremented; an optional discount code is applied to the total.',
  input: z.object({
    customerId: z.string(),
    items: z
      .array(z.object({ productId: z.string(), quantity: z.number().int().positive() }))
      .min(1),
    discountCode: z.string().optional(),
  }),
  output: z.object({
    orderId: z.string(),
    status: z.enum(['pending', 'shipped', 'delivered', 'cancelled']),
    total: z.number().describe('Total in EUR after discount'),
    discountPercent: z.number(),
  }),
  impl: async ({ customerId, items, discountCode }) => {
    if (!customers.some((c) => c.id === customerId)) {
      throw new Error(`Unknown customer id: ${customerId}`);
    }
    let discountPercent = 0;
    if (discountCode !== undefined) {
      const code = discountCodes.get(discountCode);
      if (!code || code.expired) throw new Error(`Discount code ${discountCode} is not valid`);
      discountPercent = code.percent;
    }
    const lines = items.map(({ productId, quantity }) => {
      const product = requireProduct(productId);
      const byWarehouse = inventory.get(productId) ?? {};
      const available = Object.values(byWarehouse).reduce((sum, n) => sum + n, 0);
      if (quantity > available) {
        throw new Error(`Not enough stock for ${productId}: want ${quantity}, have ${available}`);
      }
      return { productId, quantity, unitPrice: product.price };
    });
    // Commit: decrement stock (drain warehouses in order).
    for (const { productId, quantity } of lines) {
      const byWarehouse = inventory.get(productId)!;
      let remaining = quantity;
      for (const warehouse of Object.keys(byWarehouse)) {
        const take = Math.min(byWarehouse[warehouse], remaining);
        byWarehouse[warehouse] -= take;
        remaining -= take;
        if (remaining === 0) break;
      }
    }
    const subtotal = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
    const total = Math.round(subtotal * (1 - discountPercent / 100) * 100) / 100;
    const order: Order = {
      orderId: `o${nextOrderId++}`,
      customerId,
      status: 'pending',
      items: lines,
      total,
    };
    orders.push(order);
    return { orderId: order.orderId, status: order.status, total, discountPercent };
  },
});

const checkDiscountCode = defineTool({
  name: 'checkDiscountCode',
  description: 'Check whether a discount code can be used',
  input: z.object({ code: z.string() }),
  output: z.union([
    z.object({ valid: z.literal(true), percent: z.number() }),
    z.object({ valid: z.literal(false), reason: z.string() }),
  ]),
  impl: async ({ code }) => {
    const entry = discountCodes.get(code);
    if (!entry) return { valid: false as const, reason: 'unknown code' };
    if (entry.expired) return { valid: false as const, reason: 'expired' };
    return { valid: true as const, percent: entry.percent };
  },
});

const getShippingQuote = defineTool({
  name: 'getShippingQuote',
  description: 'Shipping cost and delivery estimate for a parcel',
  input: z.object({
    weightKg: z.number().positive(),
    country: z.enum(['DE', 'AT', 'CH', 'FR', 'NL']),
    speed: z.enum(['standard', 'express']).default('standard'),
  }),
  output: z.object({
    cost: z.number().describe('Cost in EUR'),
    etaDays: z.number(),
  }),
  impl: async ({ weightKg, country, speed }) => {
    const raw = shipping.base[country] + weightKg * shipping.perKg;
    const cost =
      Math.round((speed === 'express' ? raw * shipping.express.multiplier : raw) * 100) / 100;
    const etaDays =
      speed === 'express' ? shipping.express.etaDays : shipping.standardEtaDays[country];
    return { cost, etaDays };
  },
});

const convertCurrency = defineTool({
  name: 'convertCurrency',
  description: 'Convert an amount between currencies at the current rate',
  input: z.object({
    amount: z.number(),
    from: z.enum(['EUR', 'USD', 'GBP', 'CHF']),
    to: z.enum(['EUR', 'USD', 'GBP', 'CHF']),
  }),
  output: z.number(),
  impl: async ({ amount, from, to }) =>
    Math.round((amount / fxRates[from]) * fxRates[to] * 100) / 100,
});

export function createDemoRuntime() {
  return createRuntime({
    tools: [
      searchProducts,
      getProduct,
      getInventory,
      getReviews,
      getCustomer,
      listOrders,
      createOrder,
      checkDiscountCode,
      getShippingQuote,
      convertCurrency,
    ],
    checker: 'tsgo',
    maxRepairs: 2,
    limits: { timeoutMs: 5_000, memoryMb: 32 },
  });
}
