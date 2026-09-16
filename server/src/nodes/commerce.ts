import type { CredentialType, CredentialValue, NodeDefinition } from "../engine/types.js";
import { apiRequest, checkAuth } from "./api.js";
import { checkEveryField } from "./feeds.js";
import { toNumber } from "./util.js";

/* ---------- Shopify ---------- */
const shopifyBase = (credential?: CredentialValue) => {
  const shop = String(credential?.data.shop ?? "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  const domain = shop.includes(".") ? shop : `${shop}.myshopify.com`;
  return `https://${domain}/admin/api/${credential?.data.apiVersion || "2025-07"}`;
};
const shopifyHeaders = (credential?: CredentialValue) => ({ "X-Shopify-Access-Token": credential?.data.accessToken ?? "" });

/* ---------- WooCommerce ---------- */
const wooBase = (credential?: CredentialValue) => `${String(credential?.data.siteUrl ?? "").replace(/\/+$/, "")}/wp-json/wc/v3`;
const wooHeaders = (credential?: CredentialValue) => ({
  authorization: `Basic ${Buffer.from(`${credential?.data.consumerKey}:${credential?.data.consumerSecret}`).toString("base64")}`,
});

/* ---------- Stripe ---------- */
const stripeHeaders = (credential?: CredentialValue) => ({ authorization: `Bearer ${credential?.data.secretKey}` });

export const commerceCredentials: CredentialType[] = [
  {
    key: "shopifyAdmin",
    name: "Shopify",
    app: "shopify",
    description: "من لوحة Shopify ← Settings ← Apps ← Develop apps: اعمل App بصلاحيات read_orders و read_products وهات Admin API access token.",
    docsUrl: "https://help.shopify.com/en/manual/apps/app-types/custom-apps",
    fields: [
      { key: "shop", label: "اسم المتجر", required: true, placeholder: "my-store أو my-store.myshopify.com" },
      { key: "accessToken", label: "Admin API access token", secret: true, required: true, placeholder: "shpat_..." },
      { key: "apiVersion", label: "إصدار الـ API", placeholder: "2025-07" },
    ],
    test: (data) =>
      checkAuth("Shopify", `${shopifyBase({ id: "", type: "", data })}/shop.json`, shopifyHeaders({ id: "", type: "", data })),
  },
  {
    key: "wooCommerce",
    name: "WooCommerce",
    app: "woocommerce",
    description: "من WordPress ← WooCommerce ← Settings ← Advanced ← REST API ← Add key (Read/Write).",
    docsUrl: "https://woocommerce.com/document/woocommerce-rest-api/",
    fields: [
      { key: "siteUrl", label: "رابط الموقع", required: true, placeholder: "https://mystore.com" },
      { key: "consumerKey", label: "Consumer key", required: true, placeholder: "ck_..." },
      { key: "consumerSecret", label: "Consumer secret", secret: true, required: true, placeholder: "cs_..." },
    ],
    test: (data) => checkAuth("WooCommerce", `${wooBase({ id: "", type: "", data })}/orders?per_page=1`, wooHeaders({ id: "", type: "", data })),
  },
  {
    key: "stripeApi",
    name: "Stripe",
    app: "stripe",
    description: "من Stripe Dashboard ← Developers ← API keys: هات Secret key (أو Restricted key).",
    docsUrl: "https://dashboard.stripe.com/apikeys",
    fields: [{ key: "secretKey", label: "Secret key", secret: true, required: true, placeholder: "sk_live_... أو sk_test_..." }],
    test: (data) => checkAuth("Stripe", "https://api.stripe.com/v1/balance", { authorization: `Bearer ${data.secretKey}` }),
  },
];

const simplifyShopifyOrder = (o: any) => ({
  id: o.id,
  name: o.name,
  total: o.total_price,
  currency: o.currency,
  financialStatus: o.financial_status,
  customer: { name: [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" "), email: o.email, phone: o.phone ?? o.customer?.phone },
  items: (o.line_items ?? []).map((li: any) => ({ title: li.title, quantity: li.quantity, price: li.price })),
  shippingAddress: o.shipping_address,
  createdAt: o.created_at,
  raw: o,
});

const simplifyWooOrder = (o: any) => ({
  id: o.id,
  status: o.status,
  total: o.total,
  currency: o.currency,
  customer: { name: [o.billing?.first_name, o.billing?.last_name].filter(Boolean).join(" "), email: o.billing?.email, phone: o.billing?.phone },
  items: (o.line_items ?? []).map((li: any) => ({ name: li.name, quantity: li.quantity, total: li.total })),
  address: o.shipping,
  createdAt: o.date_created,
  raw: o,
});

export const commerceNodes: NodeDefinition[] = [
  {
    type: "shopify.orderTrigger",
    name: "طلب جديد في Shopify",
    description: "بيشتغل مع كل طلب جديد في متجرك على Shopify.",
    app: "shopify",
    appName: "Shopify",
    color: "#5e8e3e",
    group: "trigger",
    kind: "trigger",
    triggerType: "schedule",
    credentialTypes: ["shopifyAdmin"],
    fields: [checkEveryField],
    sampleOutput: simplifyShopifyOrder({
      id: 5123456789,
      name: "#1001",
      total_price: "450.00",
      currency: "EGP",
      financial_status: "paid",
      email: "ahmed@example.com",
      customer: { first_name: "Ahmed", last_name: "Ali" },
      line_items: [{ title: "تيشيرت", quantity: 2, price: "225.00" }],
      created_at: "2026-09-16T10:00:00+03:00",
    }),
    async poll({ credential, state, signal, testMode }) {
      const base = shopifyBase(credential);
      const headers = shopifyHeaders(credential);
      if (testMode || !state?.sinceId) {
        const latest = await apiRequest("Shopify", `${base}/orders.json?status=any&limit=1&order=created_at%20desc`, { headers, signal });
        const order = latest.orders?.[0];
        if (testMode) return { items: order ? [simplifyShopifyOrder(order)] : [], state };
        return { items: [], state: { sinceId: order?.id ?? 1 } };
      }
      const res = await apiRequest("Shopify", `${base}/orders.json?status=any&limit=50&since_id=${state.sinceId}`, { headers, signal });
      const orders = res.orders ?? [];
      return { items: orders.map(simplifyShopifyOrder), state: { sinceId: orders.length ? orders[orders.length - 1].id : state.sinceId } };
    },
  },
  {
    type: "shopify.getOrder",
    name: "جلب طلب من Shopify",
    description: "بيجيب تفاصيل طلب برقمه.",
    app: "shopify",
    appName: "Shopify",
    color: "#5e8e3e",
    group: "apps",
    kind: "action",
    credentialTypes: ["shopifyAdmin"],
    fields: [{ key: "orderId", label: "رقم الطلب (ID)", type: "text", required: true }],
    sampleOutput: { id: 5123456789, name: "#1001", total: "450.00" },
    async run({ params, credential, signal }) {
      const res = await apiRequest("Shopify", `${shopifyBase(credential)}/orders/${encodeURIComponent(String(params.orderId).trim())}.json`, {
        headers: shopifyHeaders(credential),
        signal,
      });
      return { output: simplifyShopifyOrder(res.order) };
    },
  },
  {
    type: "shopify.products",
    name: "منتجات Shopify",
    description: "بيجيب منتجات المتجر (للتقارير أو لـ AI Agent يرد بالأسعار).",
    app: "shopify",
    appName: "Shopify",
    color: "#5e8e3e",
    group: "apps",
    kind: "action",
    credentialTypes: ["shopifyAdmin"],
    fields: [
      { key: "title", label: "بحث بالاسم (اختياري)", type: "text" },
      { key: "limit", label: "أقصى عدد", type: "number", default: 50 },
    ],
    sampleOutput: { products: [{ id: 1, title: "تيشيرت", price: "225.00", inventory: 12 }], count: 1 },
    async run({ params, credential, signal }) {
      const url = new URL(`${shopifyBase(credential)}/products.json`);
      url.searchParams.set("limit", String(Math.min(Math.max(toNumber(params.limit, 50), 1), 250)));
      if (String(params.title ?? "").trim()) url.searchParams.set("title", String(params.title));
      const res = await apiRequest("Shopify", url, { headers: shopifyHeaders(credential), signal });
      const products = (res.products ?? []).map((p: any) => ({
        id: p.id,
        title: p.title,
        price: p.variants?.[0]?.price,
        inventory: p.variants?.reduce((sum: number, v: any) => sum + (v.inventory_quantity ?? 0), 0),
        image: p.image?.src ?? null,
        status: p.status,
      }));
      return { output: { products, count: products.length } };
    },
  },
  {
    type: "woocommerce.orderTrigger",
    name: "طلب جديد في WooCommerce",
    description: "بيشتغل مع كل طلب جديد في متجر WooCommerce.",
    app: "woocommerce",
    appName: "WooCommerce",
    color: "#7f54b3",
    group: "trigger",
    kind: "trigger",
    triggerType: "schedule",
    credentialTypes: ["wooCommerce"],
    fields: [checkEveryField],
    sampleOutput: simplifyWooOrder({
      id: 812,
      status: "processing",
      total: "450.00",
      currency: "EGP",
      billing: { first_name: "Ahmed", last_name: "Ali", email: "ahmed@example.com", phone: "010..." },
      line_items: [{ name: "تيشيرت", quantity: 2, total: "450.00" }],
      date_created: "2026-09-16T10:00:00",
    }),
    async poll({ credential, state, signal, testMode }) {
      const res = await apiRequest("WooCommerce", `${wooBase(credential)}/orders?per_page=20&orderby=id&order=desc`, {
        headers: wooHeaders(credential),
        signal,
      });
      const orders: any[] = Array.isArray(res) ? res : [];
      const newestId = orders[0]?.id ?? 0;
      if (testMode) return { items: orders.slice(0, 1).map(simplifyWooOrder), state };
      if (typeof state?.lastId !== "number") return { items: [], state: { lastId: newestId } };
      const fresh = orders.filter((o) => o.id > state.lastId).reverse();
      return { items: fresh.map(simplifyWooOrder), state: { lastId: Math.max(state.lastId, newestId) } };
    },
  },
  {
    type: "woocommerce.updateOrder",
    name: "تحديث حالة طلب WooCommerce",
    description: "بيغيّر حالة الطلب (قيد التجهيز، مكتمل، ملغي...).",
    app: "woocommerce",
    appName: "WooCommerce",
    color: "#7f54b3",
    group: "apps",
    kind: "action",
    credentialTypes: ["wooCommerce"],
    fields: [
      { key: "orderId", label: "رقم الطلب", type: "text", required: true },
      {
        key: "status",
        label: "الحالة الجديدة",
        type: "select",
        default: "processing",
        options: [
          { value: "pending", label: "في انتظار الدفع" },
          { value: "processing", label: "قيد التجهيز" },
          { value: "on-hold", label: "معلّق" },
          { value: "completed", label: "مكتمل" },
          { value: "cancelled", label: "ملغي" },
          { value: "refunded", label: "مسترد" },
        ],
      },
    ],
    sampleOutput: { id: 812, status: "completed" },
    async run({ params, credential, signal }) {
      const res = await apiRequest("WooCommerce", `${wooBase(credential)}/orders/${encodeURIComponent(String(params.orderId).trim())}`, {
        method: "PUT",
        json: { status: params.status },
        headers: wooHeaders(credential),
        signal,
      });
      return { output: { id: res.id, status: res.status } };
    },
  },
  {
    type: "stripe.paymentLink",
    name: "إنشاء رابط دفع Stripe",
    description: "بيعمل رابط دفع لمبلغ ومنتج معيّن تبعته للعميل.",
    app: "stripe",
    appName: "Stripe",
    color: "#635bff",
    group: "apps",
    kind: "action",
    credentialTypes: ["stripeApi"],
    fields: [
      { key: "productName", label: "اسم المنتج / الخدمة", type: "text", required: true },
      { key: "amount", label: "المبلغ", type: "number", required: true, placeholder: "500" },
      { key: "currency", label: "العملة", type: "text", default: "egp" },
    ],
    sampleOutput: { url: "https://buy.stripe.com/test_...", id: "plink_..." },
    async run({ params, credential, signal }) {
      const amount = toNumber(params.amount, NaN);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("المبلغ لازم يكون رقم أكبر من صفر");
      const headers = stripeHeaders(credential);
      const price = await apiRequest("Stripe", "https://api.stripe.com/v1/prices", {
        form: {
          currency: String(params.currency || "egp").toLowerCase(),
          unit_amount: String(Math.round(amount * 100)),
          "product_data[name]": String(params.productName ?? ""),
        },
        headers,
        signal,
      });
      const link = await apiRequest("Stripe", "https://api.stripe.com/v1/payment_links", {
        form: { "line_items[0][price]": price.id, "line_items[0][quantity]": "1" },
        headers,
        signal,
      });
      return { output: { url: link.url, id: link.id } };
    },
  },
  {
    type: "stripe.paymentTrigger",
    name: "دفع ناجح في Stripe",
    description: "بيشتغل لما عميل يكمّل دفع (Checkout / رابط دفع).",
    app: "stripe",
    appName: "Stripe",
    color: "#635bff",
    group: "trigger",
    kind: "trigger",
    triggerType: "schedule",
    credentialTypes: ["stripeApi"],
    fields: [checkEveryField],
    sampleOutput: { id: "cs_...", amount: 500, currency: "egp", customer: { name: "Ahmed", email: "ahmed@example.com", phone: null }, createdAt: "2026-09-16T10:00:00.000Z" },
    async poll({ credential, state, signal, testMode }) {
      const since = typeof state?.since === "number" ? state.since : Math.floor(Date.now() / 1000);
      const url = new URL("https://api.stripe.com/v1/checkout/sessions");
      url.searchParams.set("limit", "20");
      url.searchParams.set("status", "complete");
      if (!testMode) url.searchParams.set("created[gt]", String(since));
      const res = await apiRequest("Stripe", url, { headers: stripeHeaders(credential), signal });
      const sessions = (res.data ?? []).map((s: any) => ({
        id: s.id,
        amount: (s.amount_total ?? 0) / 100,
        currency: s.currency,
        customer: { name: s.customer_details?.name, email: s.customer_details?.email, phone: s.customer_details?.phone },
        paymentLink: s.payment_link,
        created: s.created,
        createdAt: new Date(s.created * 1000).toISOString(),
      }));
      if (testMode) return { items: sessions.slice(0, 1), state };
      if (typeof state?.since !== "number") return { items: [], state: { since } };
      const fresh = sessions.sort((a: any, b: any) => a.created - b.created);
      return { items: fresh, state: { since: fresh.length ? fresh[fresh.length - 1].created : since } };
    },
  },
];
