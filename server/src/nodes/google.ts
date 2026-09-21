import crypto from "node:crypto";
import type { CredentialType, CredentialValue, NodeDefinition } from "../engine/types.js";
import { apiRequest, parseJsonParam } from "./api.js";
import { asRecord, matchByName, NO_DATA } from "./mapping.js";
import { checkEveryField } from "./feeds.js";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");
const tokenCache = new Map<string, { token: string; expires: number }>();

/** Service-account OAuth: sign a JWT with the account's private key and swap it for an access token. */
export async function googleToken(credential: CredentialValue | undefined, signal: AbortSignal) {
  let account: { client_email?: string; private_key?: string };
  try {
    account = JSON.parse(credential?.data.serviceAccountJson ?? "");
  } catch {
    throw new Error("Google: ملف الـ Service Account مش JSON صحيح");
  }
  if (!account.client_email || !account.private_key) throw new Error("Google: ملف الـ Service Account ناقص client_email أو private_key");

  const cached = tokenCache.get(account.client_email);
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;

  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const issuedAt = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: account.client_email,
    scope: GOOGLE_SCOPES,
    aud: "https://oauth2.googleapis.com/token",
    iat: issuedAt,
    exp: issuedAt + 3600,
  })}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(account.private_key, "base64url");
  const res = await apiRequest("Google", "https://oauth2.googleapis.com/token", {
    form: { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` },
    signal,
  });
  tokenCache.set(account.client_email, { token: res.access_token, expires: Date.now() + res.expires_in * 1000 });
  return res.access_token as string;
}

export const googleCredential: CredentialType = {
  key: "googleServiceAccount",
  name: "Google (Sheets / Drive / Calendar)",
  app: "sheets",
  description:
    "من Google Cloud: فعّل Google Sheets API ← اعمل Service Account ← Keys ← Add key (JSON). الصق محتوى الملف هنا، وشارك الشيت مع إيميل الـ Service Account كـ Editor",
  docsUrl: "https://console.cloud.google.com/iam-admin/serviceaccounts",
  fields: [{ key: "serviceAccountJson", label: "محتوى ملف JSON", secret: true, required: true, placeholder: '{ "type": "service_account", ... }' }],
  async test(data) {
    await googleToken({ id: "test", type: "googleServiceAccount", data }, AbortSignal.timeout(15_000));
    return `متصل كـ ${JSON.parse(data.serviceAccountJson).client_email}`;
  },
};

const sheetsUrl = (spreadsheetId: string, range: string, suffix = "") =>
  `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId.trim())}/values/${encodeURIComponent(range)}${suffix}`;

const spreadsheetField = {
  key: "spreadsheetId",
  label: "ID الشيت",
  type: "text" as const,
  required: true,
  help: "من رابط الشيت: docs.google.com/spreadsheets/d/<ID>/edit",
};
const sheetField = { key: "sheet", label: "اسم الورقة (Tab)", type: "text" as const, default: "Sheet1" };

function rowsToObjects(values: string[][]) {
  const [headers = [], ...rows] = values;
  return rows.map((row, index) => ({
    ...Object.fromEntries(headers.map((header, i) => [header || `col${i + 1}`, row[i] ?? ""])),
    _row: index + 2,
  }));
}

async function readSheet(credential: CredentialValue | undefined, spreadsheetId: string, range: string, signal: AbortSignal) {
  const token = await googleToken(credential, signal);
  const res = await apiRequest("Google Sheets", sheetsUrl(spreadsheetId, range), { headers: { authorization: `Bearer ${token}` }, signal });
  return (res.values ?? []) as string[][];
}

export const googleNodes: NodeDefinition[] = [
  {
    type: "sheets.append",
    name: "إضافة صف في Google Sheets",
    description: "بيضيف صف جديد في آخر الشيت (عميل، طلب، رد فورم...)",
    app: "sheets",
    appName: "Google Sheets",
    color: "#0f9d58",
    group: "apps",
    kind: "action",
    credentialTypes: ["googleServiceAccount"],
    fields: [
      spreadsheetField,
      sheetField,
      {
        key: "mode",
        label: "طريقة الملء",
        type: "select",
        default: "auto",
        options: [
          { value: "auto", label: "طابق الأعمدة بالاسم (تلقائي)" },
          { value: "order", label: "أنا هحدد كل عمود بالترتيب" },
        ],
        help: "التلقائي بيقرا أسماء الأعمدة من أول صف في الشيت، وبيحط في كل عمود القيمة اللي ليها نفس الاسم من الخطوة اللي قبله",
      },
      {
        key: "record",
        label: "البيانات",
        type: "json",
        autoFill: "record",
        showIf: { field: "mode", values: ["auto"] },
        help: "نتيجة الخطوة اللي قبلها - بتتحط لوحدها. وتقدر تدوس زرار البيانات وتختار خطوة تانية",
      },
      {
        key: "row",
        label: "قيم الصف (بالترتيب)",
        type: "json",
        placeholder: '["أحمد محمد", "201012345678", "القاهرة"]',
        showIf: { field: "mode", values: ["order"] },
        help: "قيمة لكل عمود بالترتيب، ودوس زرار البيانات جوه الخانة عشان تحط قيمة من خطوة قبلها",
      },
    ],
    sampleOutput: { updatedRange: "Sheet1!A12:C12", updatedRows: 1, columns: ["الاسم", "التليفون"], missing: [] },
    async run({ params, credential, signal }) {
      const spreadsheetId = String(params.spreadsheetId);
      const sheet = String(params.sheet || "Sheet1");
      const token = await googleToken(credential, signal);
      let row: unknown[];
      let mapped: ReturnType<typeof matchByName> | undefined;

      if (params.mode === "order") {
        const given = parseJsonParam(params.row, "قيم الصف");
        if (!Array.isArray(given)) throw new Error("قيم الصف لازم تكون مصفوفة JSON");
        row = given;
      } else {
        const record = asRecord(params.record);
        if (!record) throw new Error(NO_DATA);
        const header = (await readSheet(credential, spreadsheetId, `${sheet}!1:1`, signal))[0] ?? [];
        const columns = header.map((name) => String(name ?? "").trim()).filter(Boolean);
        if (!columns.length) {
          throw new Error(`أول صف في «${sheet}» فاضي - اكتب أسماء الأعمدة في أول صف (الاسم، التليفون...) عشان نعرف كل قيمة تروح فين`);
        }
        mapped = matchByName(columns, record);
        if (!mapped.matched.length) {
          throw new Error(
            `مفيش ولا عمود اتطابق. أعمدة الشيت: ${columns.join("، ")} - والبيانات الجاية: ${mapped.unused.join("، ") || "فاضية"}. ` +
              `سمّي الأعمدة بنفس أسماء البيانات، أو غيّر «طريقة الملء» لـ «أنا هحدد كل عمود»`,
          );
        }
        row = columns.map((column) => mapped!.values[column]);
      }

      const res = await apiRequest(
        "Google Sheets",
        sheetsUrl(spreadsheetId, sheet, ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS"),
        { json: { values: [row] }, headers: { authorization: `Bearer ${token}` }, signal },
      );
      return {
        output: {
          updatedRange: res.updates?.updatedRange,
          updatedRows: res.updates?.updatedRows,
          ...(mapped ? { columns: mapped.matched, missing: mapped.missing, unused: mapped.unused } : {}),
        },
      };
    },
  },
  {
    type: "sheets.read",
    name: "قراءة صفوف من Google Sheets",
    description: "بيجيب صفوف الشيت كقايمة (أول صف = أسماء الأعمدة). استخدمه مع «تكرار على قايمة»",
    app: "sheets",
    appName: "Google Sheets",
    color: "#0f9d58",
    group: "apps",
    kind: "action",
    credentialTypes: ["googleServiceAccount"],
    fields: [spreadsheetField, sheetField, { key: "limit", label: "أقصى عدد صفوف", type: "number", default: 200 }],
    sampleOutput: { rows: [{ الاسم: "Ahmed", التليفون: "010...", _row: 2 }], count: 1 },
    async run({ params, credential, signal }) {
      const values = await readSheet(credential, String(params.spreadsheetId), String(params.sheet || "Sheet1"), signal);
      const rows = rowsToObjects(values).slice(0, Math.max(1, Number(params.limit) || 200));
      return { output: { rows, count: rows.length } };
    },
  },
  {
    type: "sheets.trigger",
    name: "صف جديد في Google Sheets",
    description: "بيشتغل لما يتضاف صف جديد في آخر الشيت",
    app: "sheets",
    appName: "Google Sheets",
    color: "#0f9d58",
    group: "trigger",
    kind: "trigger",
    triggerType: "schedule",
    credentialTypes: ["googleServiceAccount"],
    fields: [spreadsheetField, sheetField, checkEveryField],
    sampleOutput: { الاسم: "Ahmed", التليفون: "010...", _row: 12 },
    async poll({ params, credential, state, signal, testMode }) {
      const rows = rowsToObjects(await readSheet(credential, String(params.spreadsheetId), String(params.sheet || "Sheet1"), signal));
      if (testMode) return { items: rows.slice(-1), state };
      if (typeof state?.count !== "number") return { items: [], state: { count: rows.length } };
      return { items: rows.slice(state.count), state: { count: rows.length } };
    },
  },
];
