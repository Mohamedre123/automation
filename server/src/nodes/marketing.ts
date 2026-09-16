import crypto from "node:crypto";
import type { CredentialType, NodeDefinition } from "../engine/types.js";
import { apiRequest, checkAuth, parseJsonParam } from "./api.js";

const mailchimpBase = (apiKey: string) => {
  const dc = apiKey.split("-")[1];
  if (!dc) throw new Error("Mailchimp: الـ API Key لازم ينتهي بـ -usXX");
  return `https://${dc}.api.mailchimp.com/3.0`;
};
const mailchimpAuth = (apiKey: string) => ({ authorization: `Basic ${Buffer.from(`tadfuq:${apiKey}`).toString("base64")}` });

export const marketingCredentials: CredentialType[] = [
  {
    key: "hubspotToken",
    name: "HubSpot",
    app: "hubspot",
    description: "من HubSpot ← Settings ← Integrations ← Private Apps: اعمل App بصلاحية crm.objects.contacts.write وهات الـ Access token.",
    docsUrl: "https://developers.hubspot.com/docs/api/private-apps",
    fields: [{ key: "token", label: "Private App access token", secret: true, required: true, placeholder: "pat-..." }],
    test: (data) =>
      checkAuth("HubSpot", "https://api.hubapi.com/crm/v3/objects/contacts?limit=1", { authorization: `Bearer ${data.token}` }),
  },
  {
    key: "mailchimpApi",
    name: "Mailchimp",
    app: "mailchimp",
    description: "من Mailchimp ← Profile ← Extras ← API keys ← Create A Key.",
    docsUrl: "https://mailchimp.com/help/about-api-keys/",
    fields: [{ key: "apiKey", label: "API Key", secret: true, required: true, placeholder: "xxxxxxxx-us21" }],
    test: (data) => checkAuth("Mailchimp", `${mailchimpBase(data.apiKey)}/ping`, mailchimpAuth(data.apiKey)),
  },
];

export const marketingNodes: NodeDefinition[] = [
  {
    type: "hubspot.contact",
    name: "إضافة / تحديث عميل في HubSpot",
    description: "بيضيف جهة اتصال جديدة أو يحدّث الموجودة بنفس الإيميل.",
    app: "hubspot",
    appName: "HubSpot",
    color: "#ff7a59",
    group: "apps",
    kind: "action",
    credentialTypes: ["hubspotToken"],
    fields: [
      { key: "email", label: "الإيميل", type: "text", required: true },
      { key: "firstname", label: "الاسم الأول", type: "text" },
      { key: "lastname", label: "اسم العائلة", type: "text" },
      { key: "phone", label: "التليفون", type: "text" },
      { key: "properties", label: "خصائص إضافية (JSON)", type: "json", placeholder: '{ "company": "{{1.data.company}}" }' },
    ],
    sampleOutput: { id: "1234567", email: "ahmed@example.com", created: false },
    async run({ params, credential, signal }) {
      const email = String(params.email ?? "").trim().toLowerCase();
      if (!email) throw new Error("الإيميل مطلوب");
      const properties: Record<string, unknown> = { email, ...(parseJsonParam(params.properties, "الخصائص الإضافية") ?? {}) };
      for (const key of ["firstname", "lastname", "phone"]) if (String(params[key] ?? "").trim()) properties[key] = String(params[key]);
      const res = await apiRequest("HubSpot", "https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert", {
        json: { inputs: [{ idProperty: "email", id: email, properties }] },
        headers: { authorization: `Bearer ${credential?.data.token}` },
        signal,
      });
      const contact = res.results?.[0];
      return { output: { id: contact?.id, email, created: contact?.new ?? null } };
    },
  },
  {
    type: "mailchimp.subscribe",
    name: "إضافة مشترك في Mailchimp",
    description: "بيضيف إيميل لقايمة المشتركين (أو يحدّثه) مع Tags اختيارية.",
    app: "mailchimp",
    appName: "Mailchimp",
    color: "#d4a300",
    group: "apps",
    kind: "action",
    credentialTypes: ["mailchimpApi"],
    fields: [
      { key: "listId", label: "Audience ID", type: "text", required: true, help: "Audience ← Settings ← Audience name and defaults." },
      { key: "email", label: "الإيميل", type: "text", required: true },
      { key: "firstName", label: "الاسم الأول", type: "text" },
      { key: "lastName", label: "اسم العائلة", type: "text" },
      { key: "tags", label: "Tags (بفاصلة)", type: "text", placeholder: "عميل جديد, فورم الموقع" },
    ],
    sampleOutput: { id: "8a7b...", email: "ahmed@example.com", status: "subscribed" },
    async run({ params, credential, signal }) {
      const apiKey = credential?.data.apiKey ?? "";
      const base = mailchimpBase(apiKey);
      const email = String(params.email ?? "").trim().toLowerCase();
      if (!email) throw new Error("الإيميل مطلوب");
      const hash = crypto.createHash("md5").update(email).digest("hex");
      const listUrl = `${base}/lists/${encodeURIComponent(String(params.listId).trim())}/members/${hash}`;
      const member = await apiRequest("Mailchimp", listUrl, {
        method: "PUT",
        json: {
          email_address: email,
          status_if_new: "subscribed",
          merge_fields: { FNAME: String(params.firstName ?? ""), LNAME: String(params.lastName ?? "") },
        },
        headers: mailchimpAuth(apiKey),
        signal,
      });
      const tags = String(params.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
      if (tags.length) {
        await apiRequest("Mailchimp", `${listUrl}/tags`, {
          json: { tags: tags.map((name) => ({ name, status: "active" })) },
          headers: mailchimpAuth(apiKey),
          signal,
        });
      }
      return { output: { id: member.id, email, status: member.status } };
    },
  },
];
