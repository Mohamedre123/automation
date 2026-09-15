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

const telegramTrigger = (id = "1") => ({ id, type: "telegram.trigger", position: at(0), params: { updateType: "message" } });
const replyToChat = (id: string, x: number, textExpr: string, y = 0) => ({
  id,
  type: "telegram.sendMessage",
  position: at(x, y),
  params: { chatId: "{{1.message.chat.id}}", text: textExpr, replyToMessageId: "{{1.message.message_id}}" },
});

// AI steps have no credential preselected: the customer picks Gemini, OpenAI or Claude.
export const templates: Template[] = [
  {
    id: "telegram-ai-agent",
    name: "بوت تيليجرام ذكي بيفتكر المحادثة",
    description: "AI Agent بيرد على أي رسالة ويفتكر كلام كل عميل لوحده. اختار Gemini أو ChatGPT أو Claude.",
    category: "الذكاء الاصطناعي",
    graph: {
      nodes: [
        telegramTrigger(),
        { id: "2", type: "telegram.typing", position: at(1), params: { chatId: "{{1.message.chat.id}}" } },
        {
          id: "3",
          type: "ai.agent",
          position: at(2),
          params: {
            system: "أنت مساعد ودود ومفيد. رد باللهجة المصرية وباختصار (مش أكتر من 6 سطور).",
            prompt: "{{1.message.text}}",
            memoryKey: "{{1.message.chat.id}}",
            memoryLength: 12,
            tools: ["time"],
          },
        },
        replyToChat("4", 3, "{{3.text}}"),
      ],
      edges: [edge("1", "2"), edge("2", "3"), edge("3", "4")],
    },
  },
  {
    id: "telegram-support-agent",
    name: "موظف خدمة عملاء AI بمعلومات شركتك",
    description: "بيجاوب من معلومات شركتك بس (أسعار، مواعيد...) ولو العميل عايز يطلب بيسجل بياناته في مخزن البيانات.",
    category: "خدمة العملاء",
    graph: {
      nodes: [
        telegramTrigger(),
        { id: "2", type: "telegram.typing", position: at(1), params: { chatId: "{{1.message.chat.id}}" } },
        {
          id: "3",
          type: "ai.agent",
          position: at(2),
          params: {
            system:
              "أنت موظف خدمة عملاء محترف ولطيف. جاوب من المعلومات المرجعية فقط، ولو السؤال مش موجود فيها قول إنك هتحوّله لزميل. " +
              "لو العميل عايز يطلب: اجمع اسمه ورقم تليفونه وتفاصيل الطلب، واحفظهم بأداة save_data (المفتاح = رقم التليفون)، وبعدين أكّد له الطلب.",
            knowledge:
              "اسم الشركة: (اكتب اسم شركتك)\nالخدمات والأسعار:\n- خدمة 1: 500 جنيه\n- خدمة 2: 1200 جنيه\nمواعيد العمل: من السبت للخميس 10 ص - 8 م\nالعنوان: ...\nطرق الدفع: كاش، فودافون كاش، إنستاباي",
            prompt: "{{1.message.text}}",
            memoryKey: "{{1.message.chat.id}}",
            memoryLength: 16,
            tools: ["datastore", "time"],
            dataStore: "طلبات_العملاء",
          },
        },
        replyToChat("4", 3, "{{3.text}}"),
      ],
      edges: [edge("1", "2"), edge("2", "3"), edge("3", "4")],
    },
  },
  {
    id: "telegram-commands-ai",
    name: "بوت تيليجرام بأوامر + AI",
    description: "لو الرسالة /start يبعت ترحيب، غير كده الذكاء الاصطناعي يرد. مثال على التفرّع بالشروط.",
    category: "الذكاء الاصطناعي",
    graph: {
      nodes: [
        telegramTrigger(),
        {
          id: "2",
          type: "logic.if",
          position: at(1),
          params: { combine: "all", conditions: [{ left: "{{1.message.text}}", op: "starts_with", right: "/start" }] },
        },
        replyToChat("3", 2, "أهلاً {{1.message.from.first_name}} 👋\nابعتلي أي سؤال وهرد عليك فوراً.", -130),
        {
          id: "4",
          type: "ai.generate",
          position: at(2, 130),
          params: { system: "أنت مساعد مفيد. رد بالعربي وباختصار.", prompt: "{{1.message.text}}", maxTokens: 2000 },
        },
        replyToChat("5", 3, "{{4.text}}", 130),
      ],
      edges: [edge("1", "2"), edge("2", "3", "true"), edge("2", "4", "false"), edge("4", "5")],
    },
  },
  {
    id: "ai-summary-api",
    name: "API تلخيص نصوص",
    description: "ابعت نص على Webhook، يرجعلك ملخص في نفس الطلب. تقدر تربطه بموقعك أو تبيعه كخدمة.",
    category: "الذكاء الاصطناعي",
    graph: {
      nodes: [
        { id: "1", type: "trigger.webhook", position: at(0), params: {} },
        {
          id: "2",
          type: "ai.generate",
          position: at(1),
          params: { prompt: "لخّص النص التالي في 3 نقاط واضحة:\n\n{{1.body.text}}", maxTokens: 2000 },
        },
        { id: "3", type: "logic.respond", position: at(2), params: { status: 200, bodyType: "json", jsonBody: '{\n  "summary": "{{2.text}}"\n}' } },
      ],
      edges: [edge("1", "2"), edge("2", "3")],
    },
  },
  {
    id: "ai-translate-api",
    name: "API ترجمة فورية",
    description: "ابعت { text, to } ويرجعلك الترجمة. مناسب للمتاجر والمواقع متعددة اللغات.",
    category: "المحتوى",
    graph: {
      nodes: [
        { id: "1", type: "trigger.webhook", position: at(0), params: {} },
        {
          id: "2",
          type: "ai.generate",
          position: at(1),
          params: {
            system: "أنت مترجم محترف. رجّع الترجمة بس من غير أي شرح أو علامات تنصيص.",
            prompt: "ترجم النص التالي إلى {{1.body.to}}:\n\n{{1.body.text}}",
            maxTokens: 4000,
          },
        },
        { id: "3", type: "logic.respond", position: at(2), params: { status: 200, bodyType: "json", jsonBody: '{ "translation": "{{2.text}}" }' } },
      ],
      edges: [edge("1", "2"), edge("2", "3")],
    },
  },
  {
    id: "social-content-writer",
    name: "كاتب بوستات سوشيال ميديا",
    description: "ابعت موضوع ومنصة، يرجعلك 3 بوستات جاهزة للنشر.",
    category: "المحتوى",
    graph: {
      nodes: [
        { id: "1", type: "trigger.webhook", position: at(0), params: {} },
        {
          id: "2",
          type: "ai.generate",
          position: at(1),
          params: {
            system: 'أنت كاتب محتوى تسويقي مصري شاطر. رد بـ JSON بس بالشكل ده: {"posts": ["بوست 1", "بوست 2", "بوست 3"]}',
            prompt: "اكتب 3 بوستات مختلفة لمنصة {{1.body.platform}} عن: {{1.body.topic}}",
            maxTokens: 4000,
            parseJson: true,
          },
        },
        { id: "3", type: "logic.respond", position: at(2), params: { status: 200, bodyType: "json", jsonBody: '{ "posts": "{{2.json.posts}}" }' } },
      ],
      edges: [edge("1", "2"), edge("2", "3")],
    },
  },
  {
    id: "review-auto-reply",
    name: "رد تلقائي على تقييمات العملاء",
    description: "تقييم جديد يوصل ← الذكاء الاصطناعي يحدد رأي العميل ويكتب رد مناسب.",
    category: "خدمة العملاء",
    graph: {
      nodes: [
        { id: "1", type: "trigger.webhook", position: at(0), params: {} },
        {
          id: "2",
          type: "ai.generate",
          position: at(1),
          params: {
            system:
              'حلل تقييم العميل واكتب رد مهذب ومختصر باسم الشركة. رد بـ JSON بس: {"sentiment": "positive|negative|neutral", "reply": "نص الرد"}',
            prompt: "اسم العميل: {{1.body.name}}\nالتقييم: {{1.body.rating}} من 5\nالتعليق: {{1.body.review}}",
            maxTokens: 1500,
            parseJson: true,
          },
        },
        {
          id: "3",
          type: "logic.respond",
          position: at(2),
          params: { status: 200, bodyType: "json", jsonBody: '{ "sentiment": "{{2.json.sentiment}}", "reply": "{{2.json.reply}}" }' },
        },
      ],
      edges: [edge("1", "2"), edge("2", "3")],
    },
  },
  {
    id: "support-ticket-triage",
    name: "تصنيف تذاكر الدعم وتنبيه العاجل",
    description: "رسالة دعم توصل ← تتصنف ويتحدد استعجالها ← تتحفظ ← لو عاجلة يوصلك تنبيه على تيليجرام.",
    category: "خدمة العملاء",
    graph: {
      nodes: [
        { id: "1", type: "trigger.webhook", position: at(0), params: {} },
        {
          id: "2",
          type: "ai.generate",
          position: at(1),
          params: {
            system:
              'صنّف رسالة الدعم. رد بـ JSON بس: {"category": "billing|technical|sales|other", "urgency": "high|normal", "summary": "ملخص في جملة"}',
            prompt: "من: {{1.body.email}}\nالعنوان: {{1.body.subject}}\nالرسالة: {{1.body.message}}",
            maxTokens: 1000,
            parseJson: true,
          },
        },
        {
          id: "3",
          type: "datastore.set",
          position: at(2),
          params: {
            store: "tickets",
            key: "{{$execution.id}}",
            value: '{ "email": "{{1.body.email}}", "category": "{{2.json.category}}", "urgency": "{{2.json.urgency}}", "summary": "{{2.json.summary}}" }',
          },
        },
        {
          id: "4",
          type: "logic.if",
          position: at(3),
          params: { combine: "all", conditions: [{ left: "{{2.json.urgency}}", op: "equals", right: "high" }] },
        },
        {
          id: "5",
          type: "telegram.sendMessage",
          position: at(4, -100),
          params: { chatId: "", text: "🚨 تذكرة عاجلة ({{2.json.category}})\nمن: {{1.body.email}}\n{{2.json.summary}}" },
        },
      ],
      edges: [edge("1", "2"), edge("2", "3"), edge("3", "4"), edge("4", "5", "true")],
    },
  },
  {
    id: "lead-qualification",
    name: "تقييم العملاء المحتملين",
    description: "Lead جديد يوصل ← الذكاء الاصطناعي يقيّمه من 10 ← يتحفظ ← لو مهم يوصلك تنبيه.",
    category: "المبيعات والتسويق",
    graph: {
      nodes: [
        { id: "1", type: "trigger.webhook", position: at(0), params: {} },
        {
          id: "2",
          type: "ai.generate",
          position: at(1),
          params: {
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
          params: { chatId: "", text: "🔥 عميل مهم ({{2.json.score}}/10)\n{{1.body.name}} - {{1.body.company}}\n{{2.json.reason}}" },
        },
      ],
      edges: [edge("1", "2"), edge("2", "3"), edge("3", "4"), edge("4", "5", "true")],
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
        { id: "3", type: "logic.respond", position: at(2), params: { status: 200, bodyType: "json", jsonBody: '{ "ok": true, "message": "وصلتنا رسالتك" }' } },
      ],
      edges: [edge("1", "2"), edge("2", "3")],
    },
  },
  {
    id: "daily-ai-report",
    name: "تقرير يومي بالذكاء الاصطناعي",
    description: "كل يوم الصبح يجيب بيانات من أي API، يلخصها في تقرير، ويبعتها لك على تيليجرام.",
    category: "IT والتقارير",
    graph: {
      nodes: [
        { id: "1", type: "trigger.schedule", position: at(0), params: { mode: "cron", cron: "0 9 * * *", timezone: "Africa/Cairo" } },
        {
          id: "2",
          type: "http.request",
          position: at(1),
          params: { method: "GET", url: "https://api.example.com/stats/today", failOnError: false, timeoutSeconds: 30 },
        },
        {
          id: "3",
          type: "ai.generate",
          position: at(2),
          params: {
            system: "أنت محلل بيانات. اكتب تقرير قصير وواضح بالعربي لصاحب الشغل: أهم الأرقام، الملاحظات، وتوصية واحدة.",
            prompt: "البيانات:\n{{2.data}}",
            maxTokens: 3000,
          },
        },
        { id: "4", type: "telegram.sendMessage", position: at(3), params: { chatId: "", text: "📊 تقرير اليوم\n\n{{3.text}}" } },
      ],
      edges: [edge("1", "2"), edge("2", "3"), edge("3", "4")],
    },
  },
  {
    id: "uptime-monitor",
    name: "مراقبة موقع وتنبيه لو وقع",
    description: "كل 5 دقايق يفحص موقعك، ولو مش شغال يبعتلك تنبيه على تيليجرام.",
    category: "IT والتقارير",
    graph: {
      nodes: [
        { id: "1", type: "trigger.schedule", position: at(0), params: { mode: "interval", minutes: 5 } },
        { id: "2", type: "http.request", position: at(1), params: { method: "GET", url: "https://example.com", failOnError: false, timeoutSeconds: 20 } },
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
  },
];
