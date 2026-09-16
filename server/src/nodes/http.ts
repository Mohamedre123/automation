import type { CredentialType, NodeDefinition } from "../engine/types.js";
import { config } from "../config.js";
import { assertAllowedUrl, keyValueRows, parseBody, toNumber, withTimeout } from "./util.js";

export const httpCredentials: CredentialType[] = [
  {
    key: "httpHeaderAuth",
    name: "API Key في Header",
    app: "http",
    description: "لأي API بياخد المفتاح في header زي X-API-Key.",
    fields: [
      { key: "headerName", label: "اسم الـ Header", placeholder: "X-API-Key", required: true },
      { key: "headerValue", label: "القيمة", secret: true, required: true },
    ],
  },
  {
    key: "httpBearer",
    name: "Bearer Token",
    app: "http",
    description: "Authorization: Bearer <token>",
    fields: [{ key: "token", label: "Token", secret: true, required: true }],
  },
  {
    key: "httpBasic",
    name: "Basic Auth",
    app: "http",
    fields: [
      { key: "username", label: "اسم المستخدم", required: true },
      { key: "password", label: "كلمة السر", secret: true, required: true },
    ],
  },
];

export const httpRequest: NodeDefinition = {
  type: "http.request",
  name: "HTTP Request",
  description: "بيكلم أي API في الدنيا: GET / POST / PUT / DELETE مع headers وbody.",
  app: "http",
  appName: "HTTP",
  color: "#2563eb",
  group: "apps",
  kind: "action",
  credentialTypes: httpCredentials.map((c) => c.key),
  credentialOptional: true,
  fields: [
    {
      key: "method",
      label: "Method",
      type: "select",
      default: "GET",
      options: ["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => ({ value: m, label: m })),
    },
    { key: "url", label: "الرابط (URL)", type: "text", required: true, placeholder: "https://api.example.com/v1/items" },
    { key: "query", label: "Query parameters", type: "keyvalue", default: [] },
    { key: "headers", label: "Headers", type: "keyvalue", default: [] },
    {
      key: "bodyType",
      label: "نوع الـ Body",
      type: "select",
      default: "none",
      options: [
        { value: "none", label: "بدون" },
        { value: "json", label: "JSON" },
        { value: "form", label: "Form (x-www-form-urlencoded)" },
        { value: "text", label: "نص" },
      ],
    },
    { key: "jsonBody", label: "Body (JSON)", type: "json", showIf: { field: "bodyType", values: ["json"] } },
    { key: "formBody", label: "Body (Form)", type: "keyvalue", default: [], showIf: { field: "bodyType", values: ["form"] } },
    { key: "textBody", label: "Body (نص)", type: "textarea", showIf: { field: "bodyType", values: ["text"] } },
    { key: "timeoutSeconds", label: "المهلة بالثواني", type: "number", default: 30 },
    { key: "failOnError", label: "اعتبر الخطوة فشلت لو الكود 400 أو أكتر", type: "boolean", default: true },
  ],
  sampleOutput: { status: 200, statusText: "OK", headers: { "content-type": "application/json" }, data: { id: 1 } },
  async run({ params, credential, signal }) {
    let url: URL;
    try {
      url = new URL(String(params.url ?? "").trim());
    } catch {
      throw new Error("الرابط مش صحيح");
    }
    url = assertAllowedUrl(url.toString(), config.blockPrivateUrls);
    for (const row of keyValueRows(params.query)) url.searchParams.append(row.key, String(row.value ?? ""));

    const headers = new Headers();
    for (const row of keyValueRows(params.headers)) headers.set(row.key, String(row.value ?? ""));
    if (credential?.type === "httpHeaderAuth") headers.set(credential.data.headerName, credential.data.headerValue);
    if (credential?.type === "httpBearer") headers.set("authorization", `Bearer ${credential.data.token}`);
    if (credential?.type === "httpBasic") {
      const basic = Buffer.from(`${credential.data.username}:${credential.data.password}`).toString("base64");
      headers.set("authorization", `Basic ${basic}`);
    }

    const method = String(params.method || "GET").toUpperCase();
    let body: string | undefined;
    if (method !== "GET") {
      if (params.bodyType === "json" && params.jsonBody !== undefined) {
        body = JSON.stringify(params.jsonBody);
        if (!headers.has("content-type")) headers.set("content-type", "application/json");
      } else if (params.bodyType === "form") {
        body = new URLSearchParams(
          keyValueRows(params.formBody).map((r): [string, string] => [r.key, String(r.value ?? "")]),
        ).toString();
        if (!headers.has("content-type")) headers.set("content-type", "application/x-www-form-urlencoded");
      } else if (params.bodyType === "text") {
        body = String(params.textBody ?? "");
      }
    }

    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: withTimeout(signal, toNumber(params.timeoutSeconds, 30) * 1000),
    });
    const text = await response.text();
    const data = parseBody(text, response.headers.get("content-type"));
    if (params.failOnError !== false && response.status >= 400) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    return {
      output: {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        data,
      },
    };
  },
};
