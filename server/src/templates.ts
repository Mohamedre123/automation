import type { WorkflowGraph } from "./engine/types.js";

export interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  graph: WorkflowGraph;
}

const edge = (source: string, target: string, sourceHandle: string | null = null) => ({
  id: `e${source}-${target}${sourceHandle ? `-${sourceHandle}` : ""}`,
  source,
  target,
  sourceHandle,
});

const at = (x: number, y = 0) => ({ x: x * 280, y });

export const templates: Template[] = [
  {
    id: "telegram-ai-bot",
    name: "بوت تيليجرام بالذكاء الاصطناعي",
    description: "أي رسالة توصل للبوت، Claude يرد عليها تلقائياً بأسلوبك.",
    category: "الذكاء الاصطناعي",
    graph: {
      nodes: [
        { id: "1", type: "telegram.trigger", position: at(0), params: { updateType: "message", dropWebhook: true } },
        {
          id: "2",
          type: "anthropic.message",
          position: at(1),
          params: {
            model: "claude-opus-5",
            system: "أنت مساعد ودود لخدمة العملاء. رد باللهجة المصرية وباختصار (مش أكتر من 5 سطور).",
            prompt: "{{1.message.text}}",
            maxTokens: 2000,
          },
        },
        {
          id: "3",
          type: "telegram.sendMessage",
          position: at(2),
          params: { chatId: "{{1.message.chat.id}}", text: "{{2.text}}", replyToMessageId: "{{1.message.message_id}}" },
        },
      ],
      edges: [edge("1", "2"), edge("2", "3")],
    },
  },
  {
    id: "telegram-commands-ai",
    name: "بوت تيليجرام بأوامر + AI",
    description: "لو الرسالة /start يبعت ترحيب، غير كده Claude يرد. مثال على التفرّع بالشروط.",
    category: "الذكاء الاصطناعي",
    graph: {
      nodes: [
        { id: "1", type: "telegram.trigger", position: at(0), params: { updateType: "message", dropWebhook: true } },
        {
          id: "2",
          type: "logic.if",
          position: at(1),
          params: { combine: "all", conditions: [{ left: "{{1.message.text}}", op: "starts_with", right: "/start" }] },
        },
        {
          id: "3",
          type: "telegram.sendMessage",
          position: at(2, -130),
          params: {
            chatId: "{{1.message.chat.id}}",
            text: "أهلاً {{1.message.from.first_name}} 👋\nابعتلي أي سؤال وهرد عليك فوراً.",
          },
        },
        {
          id: "4",
          type: "anthropic.message",
          position: at(2, 130),
          params: {
            model: "claude-opus-5",
            system: "أنت مساعد مفيد. رد بالعربي وباختصار.",
            prompt: "{{1.message.text}}",
            maxTokens: 2000,
          },
        },
        {
          id: "5",
          type: "telegram.sendMessage",
          position: at(3, 130),
          params: { chatId: "{{1.message.chat.id}}", text: "{{4.text}}", replyToMessageId: "{{1.message.message_id}}" },
        },
      ],
      edges: [edge("1", "2"), edge("2", "3", "true"), edge("2", "4", "false"), edge("4", "5")],
    },
  },
  {
    id: "ai-summary-api",
    name: "API تلخيص نصوص بالذكاء الاصطناعي",
    description: "ابعت نص على Webhook، يرجعلك ملخص من Claude في نفس الطلب. تقدر تبيعه كخدمة.",
    category: "الذكاء الاصطناعي",
    graph: {
      nodes: [
        { id: "1", type: "trigger.webhook", position: at(0), params: {} },
        {
          id: "2",
          type: "anthropic.message",
          position: at(1),
          params: {
            model: "claude-opus-5",
            prompt: "لخّص النص التالي في 3 نقاط واضحة:\n\n{{1.body.text}}",
            maxTokens: 2000,
          },
        },
        {
          id: "3",
          type: "logic.respond",
          position: at(2),
          params: { status: 200, bodyType: "json", jsonBody: '{\n  "summary": "{{2.text}}"\n}' },
        },
      ],
      edges: [edge("1", "2"), edge("2", "3")],
    },
  },
  {
    id: "contact-form-telegram",
    name: "فورم الموقع ← إشعار تيليجرام",
    description: "أي حد يملا فورم التواصل في موقعك يوصلك إشعار فوري على تيليجرام.",
    category: "المبيعات والتسويق",
    graph: {
      nodes: [
        { id: "1", type: "trigger.webhook", position: at(0), params: {} },
        {
          id: "2",
          type: "telegram.sendMessage",
          position: at(1),
          params: {
            chatId: "",
            text: "📩 رسالة جديدة من الموقع\n\nالاسم: {{1.body.name}}\nالإيميل: {{1.body.email}}\nالرسالة: {{1.body.message}}",
          },
        },
        {
          id: "3",
          type: "logic.respond",
          position: at(2),
          params: { status: 200, bodyType: "json", jsonBody: '{ "ok": true, "message": "وصلتنا رسالتك" }' },
        },
      ],
      edges: [edge("1", "2"), edge("2", "3")],
    },
  },
  {
    id: "lead-qualification",
    name: "تقييم العملاء المحتملين بالـ AI",
    description: "Lead جديد يوصل ← Claude يقيّمه من 10 ← يتحفظ ← لو مهم يوصلك تنبيه.",
    category: "المبيعات والتسويق",
    graph: {
      nodes: [
        { id: "1", type: "trigger.webhook", position: at(0), params: {} },
        {
          id: "2",
          type: "anthropic.message",
          position: at(1),
          params: {
            model: "claude-opus-5",
            system: 'قيّم العميل المحتمل. رد بـ JSON بس بالشكل ده: {"score": رقم من 1 لـ 10, "reason": "سبب قصير"}',
            prompt: "الاسم: {{1.body.name}}\nالشركة: {{1.body.company}}\nالميزانية: {{1.body.budget}}\nالطلب: {{1.body.message}}",
            maxTokens: 1000,
            parseJson: true,
          },
        },
        {
          id: "3",
          type: "datastore.set",
          position: at(2),
          params: {
            store: "leads",
            key: "{{1.body.email}}",
            value: '{ "name": "{{1.body.name}}", "score": "{{2.json.score}}", "reason": "{{2.json.reason}}" }',
          },
        },
        {
          id: "4",
          type: "logic.if",
          position: at(3),
          params: { combine: "all", conditions: [{ left: "{{2.json.score}}", op: "gte", right: "7" }] },
        },
        {
          id: "5",
          type: "telegram.sendMessage",
          position: at(4, -100),
          params: {
            chatId: "",
            text: "🔥 عميل مهم ({{2.json.score}}/10)\n{{1.body.name}} - {{1.body.company}}\n{{2.json.reason}}",
          },
        },
      ],
      edges: [edge("1", "2"), edge("2", "3"), edge("3", "4"), edge("4", "5", "true")],
    },
  },
  {
    id: "uptime-monitor",
    name: "مراقبة موقع وتنبيه لو وقع",
    description: "كل 5 دقايق يفحص موقعك، ولو مش شغال يبعتلك تنبيه على تيليجرام.",
    category: "IT والتقنية",
    graph: {
      nodes: [
        { id: "1", type: "trigger.schedule", position: at(0), params: { mode: "interval", minutes: 5 } },
        {
          id: "2",
          type: "http.request",
          position: at(1),
          params: { method: "GET", url: "https://example.com", failOnError: false, timeoutSeconds: 20 },
        },
        {
          id: "3",
          type: "logic.if",
          position: at(2),
          params: { combine: "all", conditions: [{ left: "{{2.status}}", op: "gte", right: "400" }] },
        },
        {
          id: "4",
          type: "telegram.sendMessage",
          position: at(3, -100),
          params: { chatId: "", text: "🚨 الموقع فيه مشكلة!\nكود الحالة: {{2.status}}\nالوقت: {{$now}}" },
        },
      ],
      edges: [edge("1", "2"), edge("2", "3"), edge("3", "4", "true")],
    },
    // A network failure (site fully down) marks step 2 as failed; enable "continue on fail" there to alert on that too.
  },
];
