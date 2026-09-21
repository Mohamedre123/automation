import type { CredentialType, CredentialValue, NodeDefinition } from "../engine/types.js";
import { apiRequest, checkAuth } from "./api.js";
import { checkEveryField } from "./feeds.js";
import { toNumber } from "./util.js";

const str = (value: unknown) => String(value ?? "").trim();
const dummy = (data: Record<string, string>): CredentialValue => ({ id: "", type: "", data });

/**
 * Newest-id tracking shared by the order triggers: the first check only remembers where we are,
 * later checks return what arrived since (oldest first).
 */
function sinceLastId<T extends { id: number | string }>(items: T[], state: any, key = "lastId") {
  const numeric = (item: T) => Number(item.id) || 0;
  const lastId = Number(state?.[key] ?? 0);
  const maxId = items.reduce((max, item) => Math.max(max, numeric(item)), lastId);
  if (!state?.[key]) return { fresh: [] as T[], state: { [key]: maxId || 1 } };
  return { fresh: items.filter((item) => numeric(item) > lastId).sort((a, b) => numeric(a) - numeric(b)), state: { [key]: maxId } };
}

/* ---------- Salla ---------- */
const SALLA = "https://api.salla.dev/admin/v2";
const sallaHeaders = (c?: CredentialValue) => ({ authorization: `Bearer ${str(c?.data.accessToken)}` });

const simplifySallaOrder = (o: any) => ({
  id: o.id,
  reference: o.reference_id,
  status: o.status?.name ?? o.status,
  statusSlug: o.status?.slug,
  total: o.amounts?.total?.amount ?? o.total?.amount,
  currency: o.amounts?.total?.currency ?? o.total?.currency ?? o.currency,
  paymentMethod: o.payment_method,
  customer: {
    name: [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ") || o.customer?.full_name,
    phone: o.customer?.mobile ? `${o.customer?.mobile_code ?? ""}${o.customer.mobile}` : undefined,
    email: o.customer?.email,
  },
  items: (o.items ?? []).map((item: any) => ({ name: item.name, quantity: item.quantity })),
  createdAt: o.date?.date ?? o.created_at,
  raw: o,
});

/* ---------- Zid ---------- */
const ZID = "https://api.zid.sa/v1";
const zidHeaders = (c?: CredentialValue) => ({
  authorization: `Bearer ${str(c?.data.authorizationToken)}`,
  "X-Manager-Token": str(c?.data.accessToken),
  "Accept-Language": "ar",
  Role: "Manager",
});

const simplifyZidOrder = (o: any) => ({
  id: o.id,
  code: o.code,
  status: o.order_status?.name ?? o.order_status,
  statusCode: o.order_status?.code,
  total: o.order_total ?? o.transaction_amount,
  currency: o.currency_code,
  customer: { name: o.customer?.name, phone: o.customer?.mobile, email: o.customer?.email },
  items: (o.products ?? []).map((item: any) => ({ name: item.name, quantity: item.quantity })),
  createdAt: o.created_at,
  raw: o,
});

/* ---------- Wix Stores ---------- */
const wixHeaders = (c?: CredentialValue) => ({ authorization: str(c?.data.apiKey), "wix-site-id": str(c?.data.siteId) });
const wixSearch = (c: CredentialValue | undefined, limit: number, signal: AbortSignal) =>
  apiRequest("Wix", "https://www.wixapis.com/ecom/v1/orders/search", {
    headers: wixHeaders(c),
    json: { search: { sort: [{ fieldName: "createdDate", order: "DESC" }], cursorPaging: { limit } } },
    signal,
  });

const simplifyWixOrder = (o: any) => ({
  id: o.id,
  number: o.number,
  status: o.status,
  paymentStatus: o.paymentStatus,
  total: o.priceSummary?.total?.amount,
  currency: o.currency,
  customer: {
    name: [o.billingInfo?.contactDetails?.firstName, o.billingInfo?.contactDetails?.lastName].filter(Boolean).join(" "),
    phone: o.billingInfo?.contactDetails?.phone,
    email: o.buyerInfo?.email,
  },
  items: (o.lineItems ?? []).map((item: any) => ({ name: item.productName?.translated ?? item.productName?.original, quantity: item.quantity })),
  createdAt: o.createdDate,
  raw: o,
});

export const storeCredentials: CredentialType[] = [
  {
    key: "sallaApi",
    name: "سلة",
    app: "salla",
    description:
      "من بوابة شركاء سلة (salla.partners): اعمل تطبيق خاص لمتجرك بصلاحيات الطلبات والمنتجات، وثبّته على متجرك، وهات Access Token",
    docsUrl: "https://docs.salla.dev/",
    fields: [{ key: "accessToken", label: "Access Token", secret: true, required: true }],
    async test(data) {
      const store = await apiRequest("سلة", `${SALLA}/store/info`, { headers: sallaHeaders(dummy(data)), signal: AbortSignal.timeout(15_000) });
      return `متصل بمتجر ${store.data?.name ?? ""}`.trim();
    },
  },
  {
    key: "zidApi",
    name: "زد",
    app: "zid",
    description: "من بوابة شركاء زد (partner.zid.sa): اعمل تطبيق واربطه بمتجرك، وهات Authorization token و Access (Manager) token",
    docsUrl: "https://docs.zid.sa/",
    fields: [
      { key: "authorizationToken", label: "Authorization token", secret: true, required: true },
      { key: "accessToken", label: "Access token (X-Manager-Token)", secret: true, required: true },
    ],
    test: (data) => checkAuth("زد", `${ZID}/managers/account/profile`, zidHeaders(dummy(data))),
  },
  {
    key: "wixApi",
    name: "Wix",
    app: "wix",
    description: "من Wix ← Account settings ← API Keys: اعمل API key بصلاحية Wix Stores / eCommerce، وهات Site ID من رابط لوحة الموقع",
    docsUrl: "https://dev.wix.com/docs/rest/articles/getting-started/api-keys",
    fields: [
      { key: "apiKey", label: "API key", secret: true, required: true },
      { key: "siteId", label: "Site ID", required: true, placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
    ],
    async test(data) {
      await wixSearch(dummy(data), 1, AbortSignal.timeout(15_000));
      return "متصل ✓";
    },
  },
];

const salla = { app: "salla", appName: "سلة", color: "#004956", credentialTypes: ["sallaApi"] };
const zid = { app: "zid", appName: "زد", color: "#6d28d9", credentialTypes: ["zidApi"] };

const sampleCustomer = { name: "أحمد علي", phone: "+966500000000", email: "ahmed@example.com" };

export const storeNodes: NodeDefinition[] = [
  /* ---------- Salla ---------- */
  {
    ...salla,
    type: "salla.orderTrigger",
    name: "طلب جديد في سلة",
    description: "بيشتغل مع كل طلب جديد في متجرك على سلة",
    group: "trigger",
    kind: "trigger",
    triggerType: "schedule",
    fields: [checkEveryField],
    sampleOutput: { id: 1024567, reference: "10345", status: "بإنتظار المراجعة", total: 350, currency: "SAR", customer: sampleCustomer, items: [{ name: "عطر", quantity: 1 }] },
    async poll({ credential, state, signal, testMode }) {
      const res = await apiRequest("سلة", `${SALLA}/orders?per_page=30`, { headers: sallaHeaders(credential), signal });
      const orders: any[] = res.data ?? [];
      if (testMode) {
        const latest = [...orders].sort((a, b) => b.id - a.id)[0];
        return { items: latest ? [simplifySallaOrder(latest)] : [], state };
      }
      const { fresh, state: next } = sinceLastId(orders, state);
      return { items: fresh.map(simplifySallaOrder), state: next };
    },
  },
  {
    ...salla,
    type: "salla.getOrder",
    name: "جلب طلب من سلة",
    description: "بيجيب تفاصيل طلب برقمه",
    group: "apps",
    kind: "action",
    fields: [{ key: "orderId", label: "رقم الطلب (ID)", type: "text", required: true, placeholder: "رقم الطلب", help: "دوس زرار البيانات جوه الخانة واختار من خطوة قبلها" }],
    sampleOutput: { id: 1024567, status: "قيد التنفيذ", total: 350 },
    async run({ params, credential, signal }) {
      const res = await apiRequest("سلة", `${SALLA}/orders/${encodeURIComponent(str(params.orderId))}`, { headers: sallaHeaders(credential), signal });
      return { output: simplifySallaOrder(res.data ?? {}) };
    },
  },
  {
    ...salla,
    type: "salla.updateOrderStatus",
    name: "تغيير حالة طلب في سلة",
    description: "بيغيّر حالة الطلب (مثلاً قيد التنفيذ أو تم الشحن)",
    group: "apps",
    kind: "action",
    fields: [
      { key: "orderId", label: "رقم الطلب (ID)", type: "text", required: true, placeholder: "رقم الطلب", help: "دوس زرار البيانات جوه الخانة واختار من خطوة قبلها" },
      {
        key: "slug",
        label: "الحالة الجديدة",
        type: "combo",
        required: true,
        default: "in_progress",
        options: [
          { value: "under_review", label: "بإنتظار المراجعة" },
          { value: "in_progress", label: "قيد التنفيذ" },
          { value: "delivering", label: "جاري التوصيل" },
          { value: "delivered", label: "تم التوصيل" },
          { value: "shipped", label: "تم الشحن" },
          { value: "completed", label: "تم التنفيذ" },
          { value: "canceled", label: "ملغي" },
        ],
      },
      { key: "note", label: "ملاحظة (اختياري)", type: "text" },
    ],
    sampleOutput: { success: true },
    async run({ params, credential, signal }) {
      const res = await apiRequest("سلة", `${SALLA}/orders/${encodeURIComponent(str(params.orderId))}/status`, {
        headers: sallaHeaders(credential),
        json: { slug: str(params.slug), ...(str(params.note) ? { note: str(params.note) } : {}) },
        signal,
      });
      return { output: res };
    },
  },
  {
    ...salla,
    type: "salla.createProduct",
    name: "إضافة منتج في سلة",
    description: "بيضيف منتج جديد لمتجرك",
    group: "apps",
    kind: "action",
    fields: [
      { key: "name", label: "اسم المنتج", type: "text", required: true },
      { key: "price", label: "السعر", type: "number", required: true },
      { key: "quantity", label: "الكمية", type: "number", default: 10 },
      { key: "description", label: "الوصف", type: "textarea" },
      { key: "imageUrl", label: "رابط صورة (اختياري)", type: "text" },
    ],
    sampleOutput: { id: 998877, name: "منتج جديد", url: "https://store.salla.sa/p/998877" },
    async run({ params, credential, signal }) {
      const res = await apiRequest("سلة", `${SALLA}/products`, {
        headers: sallaHeaders(credential),
        json: {
          name: str(params.name),
          price: toNumber(params.price, 0),
          product_type: "product",
          quantity: toNumber(params.quantity, 10),
          description: str(params.description) || undefined,
          ...(str(params.imageUrl) ? { images: [{ original: str(params.imageUrl), default: true }] } : {}),
        },
        signal,
      });
      return { output: res.data ?? res };
    },
  },

  /* ---------- Zid ---------- */
  {
    ...zid,
    type: "zid.orderTrigger",
    name: "طلب جديد في زد",
    description: "بيشتغل مع كل طلب جديد في متجرك على زد",
    group: "trigger",
    kind: "trigger",
    triggerType: "schedule",
    fields: [checkEveryField],
    sampleOutput: { id: 5566778, code: "ZD-5566778", status: "جديد", total: "220.00", currency: "SAR", customer: sampleCustomer, items: [{ name: "قهوة مختصة", quantity: 2 }] },
    async poll({ credential, state, signal, testMode }) {
      const res = await apiRequest("زد", `${ZID}/managers/store/orders?per_page=30&page=1`, { headers: zidHeaders(credential), signal });
      const orders: any[] = res.orders ?? [];
      if (testMode) {
        const latest = [...orders].sort((a, b) => b.id - a.id)[0];
        return { items: latest ? [simplifyZidOrder(latest)] : [], state };
      }
      const { fresh, state: next } = sinceLastId(orders, state);
      return { items: fresh.map(simplifyZidOrder), state: next };
    },
  },
  {
    ...zid,
    type: "zid.getOrder",
    name: "جلب طلب من زد",
    description: "بيجيب تفاصيل طلب برقمه",
    group: "apps",
    kind: "action",
    fields: [{ key: "orderId", label: "رقم الطلب (ID)", type: "text", required: true, placeholder: "رقم الطلب", help: "دوس زرار البيانات جوه الخانة واختار من خطوة قبلها" }],
    sampleOutput: { id: 5566778, status: "جاري التجهيز", total: "220.00" },
    async run({ params, credential, signal }) {
      const res = await apiRequest("زد", `${ZID}/managers/store/orders/${encodeURIComponent(str(params.orderId))}/view`, {
        headers: zidHeaders(credential),
        signal,
      });
      return { output: simplifyZidOrder(res.order ?? res) };
    },
  },
  {
    ...zid,
    type: "zid.updateOrderStatus",
    name: "تغيير حالة طلب في زد",
    description: "بيغيّر حالة الطلب (جاري التجهيز، جاهز، جاري التوصيل...)",
    group: "apps",
    kind: "action",
    fields: [
      { key: "orderId", label: "رقم الطلب (ID)", type: "text", required: true, placeholder: "رقم الطلب", help: "دوس زرار البيانات جوه الخانة واختار من خطوة قبلها" },
      {
        key: "status",
        label: "الحالة الجديدة",
        type: "select",
        required: true,
        default: "preparing",
        options: [
          { value: "preparing", label: "جاري التجهيز" },
          { value: "ready", label: "جاهز" },
          { value: "indelivery", label: "جاري التوصيل" },
          { value: "delivered", label: "تم التوصيل" },
          { value: "cancelled", label: "ملغي" },
        ],
      },
    ],
    sampleOutput: { status: "object", message: { type: "object", code: null, name: null, description: null } },
    async run({ params, credential, signal }) {
      const res = await apiRequest("زد", `${ZID}/managers/store/orders/${encodeURIComponent(str(params.orderId))}/change-order-status`, {
        headers: zidHeaders(credential),
        form: { order_status: str(params.status) },
        signal,
      });
      return { output: res };
    },
  },

  /* ---------- Wix ---------- */
  {
    type: "wix.orderTrigger",
    name: "طلب جديد في Wix Stores",
    description: "بيشتغل مع كل طلب جديد في متجر Wix",
    app: "wix",
    appName: "Wix",
    color: "#1b1f2e",
    group: "trigger",
    kind: "trigger",
    triggerType: "schedule",
    credentialTypes: ["wixApi"],
    fields: [checkEveryField],
    sampleOutput: { id: "0a1b2c3d-...", number: "10012", status: "APPROVED", paymentStatus: "PAID", total: "89.00", currency: "USD", customer: sampleCustomer, items: [{ name: "Hoodie", quantity: 1 }] },
    async poll({ credential, state, signal, testMode }) {
      const res = await wixSearch(credential, 30, signal);
      const orders: any[] = res.orders ?? [];
      if (testMode) return { items: orders.slice(0, 1).map(simplifyWixOrder), state };
      const newest = orders[0]?.createdDate ?? state?.lastDate ?? new Date().toISOString();
      if (!state?.lastDate) return { items: [], state: { lastDate: newest } };
      const fresh = orders.filter((o) => String(o.createdDate) > String(state.lastDate)).reverse();
      return { items: fresh.map(simplifyWixOrder), state: { lastDate: newest > state.lastDate ? newest : state.lastDate } };
    },
  },
];
