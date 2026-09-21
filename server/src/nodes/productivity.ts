import type { CredentialType, NodeDefinition } from "../engine/types.js";
import { apiRequest, checkAuth, parseJsonParam } from "./api.js";
import { asRecord, matchByName, NO_DATA } from "./mapping.js";
import { checkEveryField } from "./feeds.js";
import { toNumber } from "./util.js";

const NOTION_VERSION = "2022-06-28";

export const productivityCredentials: CredentialType[] = [
  {
    key: "airtableToken",
    name: "Airtable",
    app: "airtable",
    description: "من airtable.com/create/tokens: اعمل Personal Access Token بصلاحيات data.records:read و write واختار القاعدة",
    docsUrl: "https://airtable.com/create/tokens",
    fields: [{ key: "token", label: "Personal Access Token", secret: true, required: true, placeholder: "pat..." }],
    test: (data) => checkAuth("Airtable", "https://api.airtable.com/v0/meta/whoami", { authorization: `Bearer ${data.token}` }),
  },
  {
    key: "notionToken",
    name: "Notion",
    app: "notion",
    description: "من notion.so/my-integrations اعمل Integration وهات الـ Secret، وبعدين من الصفحة/قاعدة البيانات ← Connections ضيف الـ Integration",
    docsUrl: "https://www.notion.so/my-integrations",
    fields: [{ key: "token", label: "Internal Integration Secret", secret: true, required: true, placeholder: "ntn_..." }],
    test: (data) =>
      checkAuth("Notion", "https://api.notion.com/v1/users/me", { authorization: `Bearer ${data.token}`, "Notion-Version": NOTION_VERSION }),
  },
  {
    key: "trelloApi",
    name: "Trello",
    app: "trello",
    description: "من trello.com/power-ups/admin اعمل Power-Up وهات الـ API Key، وبعدين اعمل Token من نفس الصفحة",
    docsUrl: "https://trello.com/power-ups/admin",
    fields: [
      { key: "key", label: "API Key", required: true },
      { key: "token", label: "Token", secret: true, required: true },
    ],
    test: (data) => checkAuth("Trello", `https://api.trello.com/1/members/me?key=${encodeURIComponent(data.key)}&token=${encodeURIComponent(data.token)}`, {}),
  },
  {
    key: "githubToken",
    name: "GitHub",
    app: "github",
    description: "من GitHub ← Settings ← Developer settings ← Personal access tokens (صلاحية Issues)",
    docsUrl: "https://github.com/settings/tokens",
    fields: [{ key: "token", label: "Personal Access Token", secret: true, required: true, placeholder: "ghp_... أو github_pat_..." }],
    test: (data) => checkAuth("GitHub", "https://api.github.com/user", { authorization: `Bearer ${data.token}`, "user-agent": "tadfuq" }),
  },
];

const airtableUrl = (baseId: string, table: string) =>
  `https://api.airtable.com/v0/${encodeURIComponent(baseId.trim())}/${encodeURIComponent(table.trim())}`;

const baseField = { key: "baseId", label: "Base ID", type: "text" as const, required: true, help: "من رابط القاعدة: الجزء اللي بيبدأ بـ app" };
const tableField = { key: "table", label: "اسم الجدول", type: "text" as const, required: true };

/** The Notion column types we can fill from plain text, and how each one wants its value. */
const NOTION_WRITABLE = new Set(["rich_text", "number", "select", "multi_select", "date", "checkbox", "url", "email", "phone_number", "status"]);

function notionValue(type: string, text: string): Record<string, unknown> | null {
  switch (type) {
    case "rich_text":
      return { rich_text: [{ text: { content: text.slice(0, 2000) } }] };
    case "number": {
      const n = Number(String(text).replace(/[^\d.-]/g, ""));
      return Number.isFinite(n) ? { number: n } : null;
    }
    case "select":
      return { select: { name: text.slice(0, 100) } };
    case "status":
      return { status: { name: text.slice(0, 100) } };
    case "multi_select":
      return { multi_select: text.split(/[,،]/).map((part) => part.trim()).filter(Boolean).slice(0, 20).map((name) => ({ name: name.slice(0, 100) })) };
    case "date": {
      const at = Date.parse(text);
      return Number.isFinite(at) ? { date: { start: new Date(at).toISOString() } } : null;
    }
    case "checkbox":
      return { checkbox: /^(true|1|نعم|أيوه|ايوه|yes)$/i.test(text.trim()) };
    case "url":
      return { url: text };
    case "email":
      return { email: text };
    case "phone_number":
      return { phone_number: text };
    default:
      return null;
  }
}

/** Notion property objects -> plain values. */
function notionPlain(properties: Record<string, any>) {
  return Object.fromEntries(
    Object.entries(properties ?? {}).map(([name, prop]) => {
      const value = prop?.[prop?.type];
      const text = Array.isArray(value) ? value.map((v: any) => v.plain_text ?? v.name ?? "").join("") : value;
      return [name, text?.name ?? text?.start ?? text?.number ?? text ?? null];
    }),
  );
}

export const productivityNodes: NodeDefinition[] = [
  {
    type: "airtable.create",
    name: "إضافة سجل في Airtable",
    description: "بيضيف سجل جديد في جدول Airtable",
    app: "airtable",
    appName: "Airtable",
    color: "#18bfff",
    group: "apps",
    kind: "action",
    credentialTypes: ["airtableToken"],
    fields: [
      baseField,
      tableField,
      {
        key: "mode",
        label: "طريقة الملء",
        type: "select",
        default: "auto",
        options: [
          { value: "auto", label: "طابق الحقول بالاسم (تلقائي)" },
          { value: "manual", label: "أنا هحدد كل حقل" },
        ],
        help: "التلقائي بيقرا أسماء الحقول من الجدول نفسه، وبيحط في كل حقل القيمة اللي ليها نفس الاسم من الخطوة اللي قبله",
      },
      {
        key: "record",
        label: "البيانات",
        type: "json",
        autoFill: "record",
        showIf: { field: "mode", values: ["auto"] },
        help: "نتيجة الخطوة اللي قبلها - بتتحط لوحدها",
      },
      {
        key: "fields",
        label: "الحقول (JSON)",
        type: "json",
        placeholder: '{ "Name": "أحمد محمد", "Phone": "201012345678" }',
        showIf: { field: "mode", values: ["manual"] },
        help: "اسم الحقل زي ما هو في Airtable، ودوس زرار البيانات جوه الخانة عشان تحط قيمة من خطوة قبلها",
      },
    ],
    sampleOutput: { id: "recXXXXXXXX", createdTime: "2026-09-16T10:00:00.000Z", fields: { Name: "Ahmed" } },
    async run({ params, credential, signal }) {
      const headers = { authorization: `Bearer ${credential?.data.token}` };
      const base = String(params.baseId);
      const table = String(params.table);
      let fields = parseJsonParam(params.fields, "الحقول");
      let mapped: ReturnType<typeof matchByName> | undefined;

      if (params.mode !== "manual") {
        const record = asRecord(params.record);
        if (!record) throw new Error(NO_DATA);
        // The table tells us its own field names; one existing record is enough to learn them.
        const url = new URL(airtableUrl(base, table));
        url.searchParams.set("maxRecords", "1");
        const sample = await apiRequest("Airtable", url, { headers, signal });
        const columns = Object.keys(sample?.records?.[0]?.fields ?? {});
        if (!columns.length) {
          throw new Error(
            `الجدول «${table}» فاضي، فمقدرناش نعرف أسماء حقوله. ضيف سجل واحد فيه بإيدك الأول، أو غيّر «طريقة الملء» لـ «أنا هحدد كل حقل»`,
          );
        }
        mapped = matchByName(columns, record);
        if (!mapped.matched.length) {
          throw new Error(
            `مفيش ولا حقل اتطابق. حقول الجدول: ${columns.join("، ")} - والبيانات الجاية: ${mapped.unused.join("، ") || "فاضية"}`,
          );
        }
        fields = Object.fromEntries(mapped.matched.map((column) => [column, mapped!.values[column]]));
      }

      const created = await apiRequest("Airtable", airtableUrl(base, table), { json: { fields, typecast: true }, headers, signal });
      return { output: { ...created, ...(mapped ? { columns: mapped.matched, missing: mapped.missing, unused: mapped.unused } : {}) } };
    },
  },
  {
    type: "airtable.search",
    name: "بحث في Airtable",
    description: "بيجيب سجلات من جدول (مع فلتر اختياري بمعادلة Airtable)",
    app: "airtable",
    appName: "Airtable",
    color: "#18bfff",
    group: "apps",
    kind: "action",
    credentialTypes: ["airtableToken"],
    fields: [
      baseField,
      tableField,
      { key: "formula", label: "معادلة الفلتر (اختياري)", type: "text", placeholder: "{Phone} = '201012345678'", help: "ودوس زرار البيانات جوه الخانة عشان تحط قيمة من خطوة قبلها" },
      { key: "maxRecords", label: "أقصى عدد", type: "number", default: 20 },
    ],
    sampleOutput: { records: [{ id: "recXXXX", Name: "Ahmed" }], count: 1 },
    async run({ params, credential, signal }) {
      const url = new URL(airtableUrl(String(params.baseId), String(params.table)));
      url.searchParams.set("maxRecords", String(Math.min(Math.max(toNumber(params.maxRecords, 20), 1), 100)));
      if (String(params.formula ?? "").trim()) url.searchParams.set("filterByFormula", String(params.formula));
      const res = await apiRequest("Airtable", url, { headers: { authorization: `Bearer ${credential?.data.token}` }, signal });
      const records = (res.records ?? []).map((r: any) => ({ id: r.id, createdTime: r.createdTime, ...r.fields }));
      return { output: { records, count: records.length } };
    },
  },
  {
    type: "airtable.trigger",
    name: "سجل جديد في Airtable",
    description: "بيشتغل لما يتضاف سجل جديد في الجدول",
    app: "airtable",
    appName: "Airtable",
    color: "#18bfff",
    group: "trigger",
    kind: "trigger",
    triggerType: "schedule",
    credentialTypes: ["airtableToken"],
    fields: [baseField, tableField, { key: "view", label: "View (اختياري)", type: "text", help: "لو الجدول كبير، اعمل View مترتب بالأحدث" }, checkEveryField],
    sampleOutput: { id: "recXXXX", createdTime: "2026-09-16T10:00:00.000Z", Name: "Ahmed" },
    async poll({ params, credential, state, signal, testMode }) {
      const url = new URL(airtableUrl(String(params.baseId), String(params.table)));
      url.searchParams.set("pageSize", "100");
      if (String(params.view ?? "").trim()) url.searchParams.set("view", String(params.view));
      const res = await apiRequest("Airtable", url, { headers: { authorization: `Bearer ${credential?.data.token}` }, signal });
      const records = (res.records ?? [])
        .map((r: any) => ({ id: r.id, createdTime: r.createdTime, ...r.fields }))
        .sort((a: any, b: any) => a.createdTime.localeCompare(b.createdTime));
      if (testMode) return { items: records.slice(-1), state };
      if (!state?.since) return { items: [], state: { since: new Date().toISOString() } };
      const fresh = records.filter((r: any) => r.createdTime > state.since);
      return { items: fresh, state: { since: fresh.length ? fresh[fresh.length - 1].createdTime : state.since } };
    },
  },
  {
    type: "notion.createPage",
    name: "إضافة صفحة في Notion",
    description: "بيضيف صف/صفحة جديدة في قاعدة بيانات Notion",
    app: "notion",
    appName: "Notion",
    color: "#52525b",
    group: "apps",
    kind: "action",
    credentialTypes: ["notionToken"],
    fields: [
      { key: "databaseId", label: "Database ID", type: "text", required: true, help: "من رابط قاعدة البيانات (32 حرف)" },
      { key: "titleProperty", label: "اسم عمود العنوان", type: "text", default: "Name" },
      { key: "title", label: "العنوان", type: "text", required: true },
      {
        key: "mode",
        label: "باقي الأعمدة",
        type: "select",
        default: "auto",
        options: [
          { value: "auto", label: "طابق الأعمدة بالاسم (تلقائي)" },
          { value: "manual", label: "أنا هحددها" },
        ],
        help: "التلقائي بيقرا أعمدة القاعدة وأنواعها، وبيحط في كل عمود القيمة اللي ليها نفس الاسم من الخطوة اللي قبله",
      },
      {
        key: "record",
        label: "البيانات",
        type: "json",
        autoFill: "record",
        showIf: { field: "mode", values: ["auto"] },
        help: "نتيجة الخطوة اللي قبلها - بتتحط لوحدها",
      },
      {
        key: "properties",
        label: "خصائص إضافية (JSON بصيغة Notion)",
        type: "json",
        placeholder: '{ "Status": { "select": { "name": "جديد" } } }',
        showIf: { field: "mode", values: ["manual"] },
      },
      { key: "content", label: "محتوى الصفحة (اختياري)", type: "textarea" },
    ],
    sampleOutput: { id: "8a2f...", url: "https://www.notion.so/...", columns: ["Status", "Phone"] },
    async run({ params, credential, signal }) {
      const headers = { authorization: `Bearer ${credential?.data.token}`, "Notion-Version": NOTION_VERSION };
      const databaseId = String(params.databaseId).trim();
      const titleProperty = String(params.titleProperty || "Name");
      let extra = parseJsonParam(params.properties, "الخصائص الإضافية") ?? {};
      let matched: string[] = [];

      if (params.mode !== "manual") {
        const record = asRecord(params.record);
        if (record) {
          // Notion says what each column is called and what type it holds; we shape the values to fit.
          const schema = await apiRequest("Notion", `https://api.notion.com/v1/databases/${databaseId}`, { headers, signal });
          const columns = Object.entries(schema?.properties ?? {}).filter(
            ([name, prop]: [string, any]) => name !== titleProperty && NOTION_WRITABLE.has(prop?.type),
          );
          const mapped = matchByName(
            columns.map(([name]) => name),
            record,
          );
          extra = { ...extra };
          for (const [name, prop] of columns) {
            const value = mapped.values[name];
            if (!value) continue;
            const built = notionValue((prop as any).type, value);
            if (built) {
              extra[name] = built;
              matched.push(name);
            }
          }
        }
      }

      const content = String(params.content ?? "").trim();
      const res = await apiRequest("Notion", "https://api.notion.com/v1/pages", {
        json: {
          parent: { database_id: databaseId },
          properties: { ...extra, [titleProperty]: { title: [{ text: { content: String(params.title ?? "") } }] } },
          ...(content
            ? {
                children: content.split(/\n{2,}/).slice(0, 50).map((paragraph) => ({
                  object: "block",
                  type: "paragraph",
                  paragraph: { rich_text: [{ type: "text", text: { content: paragraph.slice(0, 2000) } }] },
                })),
              }
            : {}),
        },
        headers: { authorization: `Bearer ${credential?.data.token}`, "Notion-Version": NOTION_VERSION },
        signal,
      });
      return { output: { id: res.id, url: res.url, ...(matched.length ? { columns: matched } : {}) } };
    },
  },
  {
    type: "notion.query",
    name: "بحث في قاعدة بيانات Notion",
    description: "بيجيب صفوف من قاعدة بيانات Notion (مع فلتر اختياري)",
    app: "notion",
    appName: "Notion",
    color: "#52525b",
    group: "apps",
    kind: "action",
    credentialTypes: ["notionToken"],
    fields: [
      { key: "databaseId", label: "Database ID", type: "text", required: true },
      { key: "filter", label: "فلتر (JSON بصيغة Notion - اختياري)", type: "json" },
      { key: "limit", label: "أقصى عدد", type: "number", default: 20 },
    ],
    sampleOutput: { results: [{ id: "8a2f...", url: "https://www.notion.so/...", Name: "مهمة" }], count: 1 },
    async run({ params, credential, signal }) {
      const filter = parseJsonParam(params.filter, "الفلتر");
      const res = await apiRequest("Notion", `https://api.notion.com/v1/databases/${String(params.databaseId).trim()}/query`, {
        json: { page_size: Math.min(Math.max(toNumber(params.limit, 20), 1), 100), ...(filter ? { filter } : {}) },
        headers: { authorization: `Bearer ${credential?.data.token}`, "Notion-Version": NOTION_VERSION },
        signal,
      });
      const results = (res.results ?? []).map((page: any) => ({ id: page.id, url: page.url, ...notionPlain(page.properties) }));
      return { output: { results, count: results.length } };
    },
  },
  {
    type: "trello.card",
    name: "إنشاء كارت في Trello",
    description: "بيضيف كارت جديد في قايمة على Trello (مهمة، طلب، عميل...)",
    app: "trello",
    appName: "Trello",
    color: "#0079bf",
    group: "apps",
    kind: "action",
    credentialTypes: ["trelloApi"],
    fields: [
      { key: "listId", label: "List ID", type: "text", required: true, help: "افتح الكارت في المتصفح وضيف .json للرابط عشان تشوف idList" },
      { key: "name", label: "العنوان", type: "text", required: true },
      { key: "desc", label: "الوصف", type: "textarea" },
    ],
    sampleOutput: { id: "65f...", url: "https://trello.com/c/..." },
    async run({ params, credential, signal }) {
      const url = new URL("https://api.trello.com/1/cards");
      url.searchParams.set("key", credential?.data.key ?? "");
      url.searchParams.set("token", credential?.data.token ?? "");
      const res = await apiRequest("Trello", url, {
        json: { idList: String(params.listId).trim(), name: String(params.name ?? ""), desc: String(params.desc ?? "") },
        signal,
      });
      return { output: { id: res.id, url: res.url } };
    },
  },
  {
    type: "github.issue",
    name: "إنشاء Issue في GitHub",
    description: "بيفتح Issue جديدة في مستودع (بلاغ مشكلة، طلب ميزة...)",
    app: "github",
    appName: "GitHub",
    color: "#6e5494",
    group: "apps",
    kind: "action",
    credentialTypes: ["githubToken"],
    fields: [
      { key: "repo", label: "المستودع", type: "text", required: true, placeholder: "owner/repo" },
      { key: "title", label: "العنوان", type: "text", required: true },
      { key: "body", label: "التفاصيل", type: "textarea" },
    ],
    sampleOutput: { number: 42, url: "https://github.com/owner/repo/issues/42" },
    async run({ params, credential, signal }) {
      const repo = String(params.repo ?? "").trim();
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("المستودع لازم يكون بالشكل owner/repo");
      const res = await apiRequest("GitHub", `https://api.github.com/repos/${repo}/issues`, {
        json: { title: String(params.title ?? ""), body: String(params.body ?? "") },
        headers: {
          authorization: `Bearer ${credential?.data.token}`,
          "user-agent": "tadfuq",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal,
      });
      return { output: { number: res.number, url: res.html_url } };
    },
  },
];
