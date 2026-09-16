import type { WorkflowGraph } from "./engine/types.js";

export interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  /** Shown on the card: what the customer must have before using it. */
  requires: string[];
  graph: WorkflowGraph;
}

const edge = (source: string, target: string, sourceHandle: string | null = null) => ({
  id: `e${source}-${target}${sourceHandle ? `-${sourceHandle}` : ""}`,
  source,
  target,
  sourceHandle,
});

const at = (x: number, y = 0) => ({ x: x * 280, y });

const AI_ACCOUNT = "حساب ذكاء اصطناعي: Gemini (فيه باقة مجانية) أو ChatGPT أو Claude - أو أي مزوّد تاني عندك مفتاحه";
const telegramTrigger = (id = "1") => ({ id, type: "telegram.trigger", position: at(0), params: { updateType: "message" } });
const replyToChat = (id: string, x: number, textExpr: string, y = 0) => ({
  id,
  type: "telegram.sendMessage",
  position: at(x, y),
  params: { chatId: "{{1.message.chat.id}}", text: textExpr, replyToMessageId: "{{1.message.message_id}}" },
});

export const templates: Template[] = [
  /* ---------- واتساب ---------- */
  {
    id: "whatsapp-ai-agent",
    name: "بوت واتساب ذكي يرد على العملاء",
    description: "أي رسالة واتساب توصل، الـ AI Agent يرد عليها من معلومات شركتك ويفتكر كلام كل عميل لوحده.",
    category: "واتساب",
    requires: [AI_ACCOUNT, "حساب WasenderAPI (أرخص طريقة لربط واتساب)", "بوت تيليجرام أو واتساب يوصلك عليه إشعار لما عميل يطلب موظف"],
    graph: {
      nodes: [
        { id: "1", type: "wasender.trigger", position: at(0), params: { eventType: "messages.received", ignoreGroups: true } },
        {
          id: "2",
          type: "ai.agent",
          position: at(1),
          params: {
            system: "أنت موظف خدمة عملاء لطيف. رد باللهجة المصرية وباختصار، واعتمد على المعلومات المرجعية بس. لو العميل طلب يكلم خدمة العملاء أو موظف أو اشتكى: خد اسمه ورقمه واستخدم أداة handoff_to_human.",
            knowledge:
              "اسم الشركة: (اكتب اسم شركتك)\nالخدمات والأسعار:\n- خدمة 1: 500 جنيه\n- خدمة 2: 1200 جنيه\nمواعيد العمل: من السبت للخميس 10 ص - 8 م\nطرق الدفع: كاش، فودافون كاش، إنستاباي",
            prompt: "{{1.text}}",
            memoryKey: "{{1.phone}}",
            memoryLength: 14,
            tools: ["handoff", "time"],
            handoffPauseHours: 24,
          },
        },
        { id: "3", type: "wasender.send", position: at(2), params: { to: "{{1.phone}}", messageType: "text", text: "{{2.text}}" } },
      ],
      edges: [edge("1", "2"), edge("2", "3")],
    },
  },
  {
    id: "whatsapp-official-support",
    name: "بوت واتساب الرسمي (Meta Cloud API)",
    description: "نفس بوت خدمة العملاء بس على رقم واتساب الرسمي المعتمد من Meta.",
    category: "واتساب",
    requires: [AI_ACCOUNT, "رقم واتساب رسمي على Meta Cloud API", "بوت تيليجرام أو واتساب يوصلك عليه إشعار لما عميل يطلب موظف"],
    graph: {
      nodes: [
        { id: "1", type: "whatsapp.trigger", position: at(0), params: {} },
        {
          id: "2",
          type: "ai.agent",
          position: at(1),
          params: {
            system: "أنت موظف خدمة عملاء محترف. رد باختصار وباللهجة المصرية. لو العميل طلب يكلم خدمة العملاء أو موظف أو اشتكى: خد اسمه ورقمه واستخدم أداة handoff_to_human.",
            knowledge: "اكتب هنا معلومات شركتك: الخدمات، الأسعار، المواعيد، سياسة الاسترجاع.",
            prompt: "{{1.text}}",
            memoryKey: "{{1.phone}}",
            memoryLength: 14,
            tools: ["handoff"],
            handoffPauseHours: 24,
          },
        },
        { id: "3", type: "whatsapp.send", position: at(2), params: { to: "{{1.phone}}", messageType: "text", text: "{{2.text}}" } },
      ],
      edges: [edge("1", "2"), edge("2", "3")],
    },
  },
  {
    id: "whatsapp-order-collector",
    name: "استقبال طلبات على واتساب وحفظها",
    description: "الـ Agent بيجمع اسم العميل ورقمه وتفاصيل طلبه، بيحفظهم في مخزن البيانات، ويبعتلك إشعار على تيليجرام.",
    category: "واتساب",
    requires: [AI_ACCOUNT, "حساب WasenderAPI", "بوت تيليجرام (للإشعارات)"],
    graph: {
      nodes: [
        { id: "1", type: "wasender.trigger", position: at(0), params: { eventType: "messages.received", ignoreGroups: true } },
        {
          id: "2",
          type: "ai.agent",
          position: at(1),
          params: {
            system:
              "أنت مندوب مبيعات. اجمع من العميل: الاسم، المنتج المطلوب، والعنوان. لما تكمّل البيانات استخدم أداة save_data (المفتاح = رقم العميل) واحفظها، وبعدين أكّد الطلب للعميل واكتب في آخر ردك [ORDER_DONE].",
            prompt: "{{1.text}}",
            memoryKey: "{{1.phone}}",
            memoryLength: 20,
            tools: ["datastore", "time"],
            dataStore: "طلبات_واتساب",
          },
        },
        { id: "3", type: "wasender.send", position: at(2), params: { to: "{{1.phone}}", messageType: "text", text: "{{2.text}}" } },
        {
          id: "4",
          type: "logic.if",
          position: at(3),
          params: { combine: "all", conditions: [{ left: "{{2.text}}", op: "contains", right: "[ORDER_DONE]" }] },
        },
        {
          id: "5",
          type: "telegram.sendMessage",
          position: at(4, -110),
          params: { chatId: "", text: "🛒 طلب جديد من واتساب\nالرقم: {{1.phone}}\n\n{{2.text}}" },
        },
      ],
      edges: [edge("1", "2"), edge("2", "3"), edge("3", "4"), edge("4", "5", "true")],
    },
  },

  /* ---------- السوشيال ميديا ---------- */
  {
    id: "social-publish-all",
    name: "بوست واحد ينشر على كل المنصات",
    description: "اكتب الموضوع في فورم: الذكاء الاصطناعي يكتب البوست ويعمل الصورة، وينشرهم على فيسبوك وإنستجرام وتيليجرام.",
    category: "سوشيال ميديا",
    requires: [AI_ACCOUNT, "صفحة فيسبوك", "حساب إنستجرام بيزنس", "بوت/قناة تيليجرام"],
    graph: {
      nodes: [
        {
          id: "1",
          type: "trigger.form",
          position: at(0),
          params: {
            title: "انشر بوست جديد",
            description: "اكتب موضوع البوست وهيتنشر على كل المنصات.",
            formFields: [{ key: "topic", value: "موضوع البوست" }],
            submitLabel: "انشر",
            successMessage: "اتنشر ✓",
          },
        },
        {
          id: "2",
          type: "ai.generate",
          position: at(1),
          params: {
            system: "أنت كاتب محتوى تسويقي مصري. اكتب بوست قصير وجذاب مع هاشتاجات مناسبة، من غير أي مقدمات أو شرح.",
            prompt: "اكتب بوست سوشيال ميديا عن: {{1.data.topic}}",
            maxTokens: 1500,
          },
        },
        {
          id: "3",
          type: "ai.image",
          position: at(2),
          params: { prompt: "صورة احترافية لبوست سوشيال ميديا عن: {{1.data.topic}}، بدون كتابة على الصورة", size: "1024x1280" },
        },
        { id: "4", type: "facebook.post", position: at(3, -150), params: { message: "{{2.text}}", imageUrl: "{{3.url}}" } },
        { id: "5", type: "instagram.post", position: at(3, 0), params: { imageUrl: "{{3.url}}", caption: "{{2.text}}" } },
        { id: "6", type: "telegram.sendPhoto", position: at(3, 150), params: { chatId: "", photo: "{{3.url}}", caption: "{{2.text}}" } },
        {
          id: "7",
          type: "logic.respond",
          position: at(4, 300),
          params: { status: 200, bodyType: "json", jsonBody: '{ "text": "{{2.text}}", "image": "{{3.url}}" }' },
        },
      ],
      edges: [edge("1", "2"), edge("2", "3"), edge("3", "4"), edge("3", "5"), edge("3", "6"), edge("3", "7")],
    },
  },
  {
    id: "daily-instagram-post",
    name: "بوست إنستجرام يومي تلقائي",
    description: "كل يوم في ميعاد ثابت: فكرة بوست جديدة + صورة بالذكاء الاصطناعي + نشر على إنستجرام.",
    category: "سوشيال ميديا",
    requires: [AI_ACCOUNT, "حساب إنستجرام بيزنس"],
    graph: {
      nodes: [
        { id: "1", type: "trigger.schedule", position: at(0), params: { mode: "cron", cron: "0 12 * * *", timezone: "Africa/Cairo" } },
        {
          id: "2",
          type: "ai.generate",
          position: at(1),
          params: {
            system:
              'أنت مسؤول سوشيال ميديا. اقترح بوست جديد لليوم. رد بـ JSON بس: {"caption": "نص البوست مع هاشتاجات", "image": "وصف الصورة بالإنجليزي"}',
            prompt: "مجال الشغل: (اكتب مجالك هنا، مثلاً: متجر ملابس رجالي في القاهرة)",
            maxTokens: 1500,
            parseJson: true,
          },
        },
        { id: "3", type: "ai.image", position: at(2), params: { prompt: "{{2.json.image}}", size: "1024x1280" } },
        { id: "4", type: "instagram.post", position: at(3), params: { imageUrl: "{{3.url}}", caption: "{{2.json.caption}}" } },
      ],
      edges: [edge("1", "2"), edge("2", "3"), edge("3", "4")],
    },
  },
  {
    id: "ai-image-form",
    name: "اعمل صورة بالذكاء الاصطناعي من فورم",
    description: "فورم بسيط تكتب فيه وصف الصورة، والصورة تتعمل وتظهرلك قدامك وتتحفظ في مكتبة الصور.",
    category: "سوشيال ميديا",
    requires: ["حساب Gemini أو OpenAI"],
    graph: {
      nodes: [
        {
          id: "1",
          type: "trigger.form",
          position: at(0),
          params: {
            title: "اعمل صورتك بالذكاء الاصطناعي",
            description: "اكتب وصف الصورة اللي في بالك بالتفصيل.",
            formFields: [{ key: "idea", value: "وصف الصورة" }],
            submitLabel: "اعمل الصورة",
            successMessage: "الصورة جاهزة ✓",
          },
        },
        { id: "2", type: "ai.image", position: at(1), params: { prompt: "{{1.data.idea}}", size: "1024x1280", folder: "مولّدة" } },
        { id: "3", type: "logic.respond", position: at(2), params: { status: 200, bodyType: "json", jsonBody: '{ "text": "الصورة جاهزة ✓", "image": "{{2.url}}" }' } },
      ],
      edges: [edge("1", "2"), edge("2", "3")],
    },
  },
  {
    id: "product-posts-daily",
    name: "انشر منتج كل يوم بصورة إعلانية احترافية",
    description:
      "ارفع صور منتجاتك في مكتبة الصور مرة واحدة: كل يوم بياخد منتج بالترتيب، يعمل منه صورة إعلانية بالـ AI، يكتب البوست، وينشر على إنستجرام وفيسبوك.",
    category: "سوشيال ميديا",
    requires: ["صور منتجاتك في مكتبة الصور (فولدر «منتجات»)", "حساب Gemini (للصور والكتابة)", "حساب إنستجرام بيزنس", "صفحة فيسبوك"],
    graph: {
      nodes: [
        { id: "1", type: "trigger.schedule", position: at(0), params: { mode: "cron", cron: "0 18 * * *", timezone: "Africa/Cairo" } },
        { id: "2", type: "media.pick", position: at(1), params: { folder: "منتجات", mode: "sequential" } },
        {
          id: "3",
          type: "ai.image",
          position: at(2),
          params: {
            referenceImage: "{{2.url}}",
            prompt:
              "حوّل صورة المنتج دي لصورة إعلانية احترافية لسوشيال ميديا: إضاءة استوديو، خلفية أنيقة مناسبة للمنتج، من غير أي كتابة. المنتج: {{2.name}}",
            size: "1024x1280",
            folder: "إعلانات المنتجات",
          },
        },
        {
          id: "4",
          type: "ai.generate",
          position: at(3),
          params: {
            system: "أنت مسؤول سوشيال ميديا مصري شاطر. اكتب بوست قصير جذاب مع دعوة للشراء وهاشتاجات، من غير مقدمات.",
            prompt: "اكتب بوست لمنتج اسمه: {{2.name}}",
            maxTokens: 1500,
          },
        },
        { id: "5", type: "instagram.post", position: at(4, -90), params: { imageUrl: "{{3.url}}", caption: "{{4.text}}" } },
        { id: "6", type: "facebook.post", position: at(4, 90), params: { message: "{{4.text}}", imageUrl: "{{3.url}}" } },
      ],
      edges: [edge("1", "2"), edge("2", "3"), edge("3", "4"), edge("4", "5"), edge("4", "6")],
    },
  },
  {
    id: "social-content-writer",
    name: "كاتب بوستات سوشيال ميديا",
    description: "ابعت موضوع ومنصة، يرجعلك 3 بوستات جاهزة للنشر تختار منهم.",
    category: "سوشيال ميديا",
    requires: [AI_ACCOUNT],
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

  /* ---------- تيليجرام ---------- */
  {
    id: "telegram-ai-agent",
    name: "بوت تيليجرام ذكي بيفتكر المحادثة",
    description: "AI Agent بيرد على أي رسالة في تيليجرام ويفتكر كلام كل عميل لوحده.",
    category: "تيليجرام",
    requires: [AI_ACCOUNT, "بوت تيليجرام من BotFather"],
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
    name: "موظف خدمة عملاء على تيليجرام",
    description: "بيجاوب من معلومات شركتك بس، ولو العميل عايز يطلب بيسجل بياناته في مخزن البيانات.",
    category: "خدمة العملاء",
    requires: [AI_ACCOUNT, "بوت تيليجرام من BotFather"],
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
              "لو العميل عايز يطلب: اجمع اسمه ورقم تليفونه وتفاصيل الطلب، واحفظهم بأداة save_data (المفتاح = رقم التليفون)، وبعدين أكّد له الطلب. لو العميل طلب يكلم خدمة العملاء أو موظف أو اشتكى: خد اسمه ورقمه واستخدم أداة handoff_to_human.",
            knowledge:
              "اسم الشركة: (اكتب اسم شركتك)\nالخدمات والأسعار:\n- خدمة 1: 500 جنيه\n- خدمة 2: 1200 جنيه\nمواعيد العمل: من السبت للخميس 10 ص - 8 م\nالعنوان: ...",
            prompt: "{{1.message.text}}",
            memoryKey: "{{1.message.chat.id}}",
            memoryLength: 16,
            tools: ["handoff", "datastore", "time"],
            handoffPauseHours: 24,
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
    category: "تيليجرام",
    requires: [AI_ACCOUNT, "بوت تيليجرام من BotFather"],
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

  /* ---------- المتاجر الإلكترونية ---------- */
  {
    id: "shopify-order-whatsapp",
    name: "طلب Shopify جديد ← رسالة واتساب للعميل + إشعار للفريق",
    description: "مع كل طلب جديد: العميل يستلم رسالة تأكيد على واتساب، والفريق يوصله ملخص الطلب على Slack.",
    category: "المتاجر الإلكترونية",
    requires: ["متجر Shopify (Admin API token)", "حساب WasenderAPI", "Slack"],
    graph: {
      nodes: [
        { id: "1", type: "shopify.orderTrigger", position: at(0), params: { minutes: 5 } },
        {
          id: "2",
          type: "wasender.send",
          position: at(1, -90),
          params: {
            to: "{{1.customer.phone}}",
            messageType: "text",
            text: "أهلاً {{1.customer.name}} 👋\nطلبك رقم {{1.name}} اتسجل بنجاح بإجمالي {{1.total}} {{1.currency}}.\nهنتواصل معاك قريب لتأكيد الشحن.",
          },
        },
        {
          id: "3",
          type: "slack.message",
          position: at(1, 90),
          params: { channel: "#orders", text: "🛒 طلب جديد {{1.name}} - {{1.customer.name}} - {{1.total}} {{1.currency}}" },
        },
      ],
      edges: [edge("1", "2"), edge("1", "3")],
    },
  },
  {
    id: "woocommerce-order-telegram",
    name: "طلب WooCommerce جديد ← إشعار تيليجرام",
    description: "كل طلب جديد في متجر ووردبريس يوصلك فوراً على تيليجرام بالتفاصيل.",
    category: "المتاجر الإلكترونية",
    requires: ["متجر WooCommerce (REST API key)", "بوت تيليجرام"],
    graph: {
      nodes: [
        { id: "1", type: "woocommerce.orderTrigger", position: at(0), params: { minutes: 5 } },
        {
          id: "2",
          type: "telegram.sendMessage",
          position: at(1),
          params: {
            chatId: "",
            text: "🛒 طلب جديد #{{1.id}}\nالعميل: {{1.customer.name}} - {{1.customer.phone}}\nالإجمالي: {{1.total}} {{1.currency}}",
          },
        },
      ],
      edges: [edge("1", "2")],
    },
  },
  {
    id: "stripe-payment-crm",
    name: "دفع Stripe ناجح ← HubSpot + إيميل شكر",
    description: "لما عميل يدفع: يتسجل أو يتحدّث في HubSpot، ويوصله إيميل شكر تلقائي.",
    category: "المتاجر الإلكترونية",
    requires: ["Stripe (Secret key)", "HubSpot (Private App)", "إيميل عن طريق Resend"],
    graph: {
      nodes: [
        { id: "1", type: "stripe.paymentTrigger", position: at(0), params: { minutes: 5 } },
        {
          id: "2",
          type: "hubspot.contact",
          position: at(1),
          params: { email: "{{1.customer.email}}", firstname: "{{1.customer.name}}", phone: "{{1.customer.phone}}" },
        },
        {
          id: "3",
          type: "email.send",
          position: at(2),
          params: {
            to: "{{1.customer.email}}",
            subject: "شكراً لدفعك 🙏",
            body: "أهلاً {{1.customer.name}},\n\nوصلنا دفعك بقيمة {{1.amount}} {{1.currency}}. شكراً لثقتك فينا!",
            format: "text",
          },
        },
      ],
      edges: [edge("1", "2"), edge("2", "3")],
    },
  },

  /* ---------- جداول وبيانات ---------- */
  {
    id: "form-to-sheets-welcome",
    name: "فورم تسجيل ← Google Sheets + إيميل ترحيب",
    description: "أي حد يسجّل من الفورم بيتضاف صف في الشيت، ويوصله إيميل ترحيب فوراً.",
    category: "المبيعات والتسويق",
    requires: ["Google Sheets (Service Account)", "إيميل عن طريق Resend"],
    graph: {
      nodes: [
        {
          id: "1",
          type: "trigger.form",
          position: at(0),
          params: {
            title: "سجّل معانا",
            formFields: [
              { key: "name", value: "الاسم" },
              { key: "email", value: "الإيميل" },
              { key: "phone", value: "رقم الموبايل" },
            ],
            submitLabel: "تسجيل",
            successMessage: "تم التسجيل ✓ هيوصلك إيميل حالاً",
          },
        },
        {
          id: "2",
          type: "sheets.append",
          position: at(1),
          params: { spreadsheetId: "", sheet: "Sheet1", row: '["{{1.data.name}}", "{{1.data.email}}", "{{1.data.phone}}", "{{$now}}"]' },
        },
        {
          id: "3",
          type: "email.send",
          position: at(2),
          params: { to: "{{1.data.email}}", subject: "أهلاً بيك!", body: "أهلاً {{1.data.name}},\n\nتم تسجيلك بنجاح وهنتواصل معاك قريب.", format: "text" },
        },
      ],
      edges: [edge("1", "2"), edge("2", "3")],
    },
  },
  {
    id: "sheet-daily-reminders",
    name: "تذكير يومي على واتساب من Google Sheets",
    description: "كل يوم الصبح يقرأ الشيت، ويبعت رسالة تذكير على واتساب لكل عميل ميعاده النهارده. مثال على التكرار والفلتر.",
    category: "أدوات",
    requires: ["Google Sheets فيه أعمدة: الاسم، الموبايل، الميعاد (YYYY-MM-DD)", "حساب WasenderAPI"],
    graph: {
      nodes: [
        { id: "1", type: "trigger.schedule", position: at(0), params: { mode: "cron", cron: "0 9 * * *", timezone: "Africa/Cairo" } },
        { id: "2", type: "sheets.read", position: at(1), params: { spreadsheetId: "", sheet: "Sheet1", limit: 500 } },
        { id: "3", type: "logic.iterator", position: at(2), params: { list: "{{2.rows}}", limit: 200 } },
        { id: "4", type: "tools.date", position: at(3), params: { operation: "format", date: "{{$now}}", format: "ymd", timezone: "Africa/Cairo" } },
        {
          id: "5",
          type: "logic.filter",
          position: at(4),
          params: { combine: "all", conditions: [{ left: "{{3.الميعاد}}", op: "equals", right: "{{4.result}}" }] },
        },
        {
          id: "6",
          type: "wasender.send",
          position: at(5),
          params: { to: "{{3.الموبايل}}", messageType: "text", text: "أهلاً {{3.الاسم}} 👋\nبنفكّرك إن ميعادك النهارده. مستنيينك!" },
        },
      ],
      edges: [edge("1", "2"), edge("2", "3"), edge("3", "4"), edge("4", "5"), edge("5", "6")],
    },
  },
  {
    id: "rss-ai-digest",
    name: "أخبار RSS ← ملخص بالذكاء الاصطناعي ← تيليجرام",
    description: "أي خبر جديد في موقع أو مدونة بيتلخّص في سطرين وينزل على قناة التيليجرام بتاعتك.",
    category: "المحتوى",
    requires: ["رابط RSS", AI_ACCOUNT, "بوت تيليجرام (أدمن في القناة)"],
    graph: {
      nodes: [
        { id: "1", type: "rss.trigger", position: at(0), params: { url: "", minutes: 30 } },
        {
          id: "2",
          type: "ai.generate",
          position: at(1),
          params: {
            system: "لخّص الخبر في سطرين بالعربي بأسلوب جذاب، من غير مقدمات.",
            prompt: "العنوان: {{1.title}}\nالتفاصيل: {{1.description}}",
            maxTokens: 800,
          },
        },
        {
          id: "3",
          type: "telegram.sendMessage",
          position: at(2),
          params: { chatId: "@your_channel", text: "📰 {{1.title}}\n\n{{2.text}}\n\n🔗 {{1.link}}" },
        },
      ],
      edges: [edge("1", "2"), edge("2", "3")],
    },
  },

  {
    id: "ai-blog-wordpress-social",
    name: "مقال أسبوعي بالذكاء الاصطناعي ← WordPress ← LinkedIn و X و فيسبوك",
    description: "كل أسبوع: الذكاء الاصطناعي يكتب مقال عن مجالك بصورة بارزة، ينزل على موقعك، ويتشارك رابطه على LinkedIn و X وفيسبوك.",
    category: "المحتوى",
    requires: [AI_ACCOUNT, "موقع WordPress (Application Password)", "LinkedIn", "X (تويتر)", "صفحة فيسبوك"],
    graph: {
      nodes: [
        { id: "1", type: "trigger.schedule", position: at(0), params: { mode: "cron", cron: "0 10 * * 0", timezone: "Africa/Cairo" } },
        {
          id: "2",
          type: "ai.generate",
          position: at(1),
          params: {
            system:
              'أنت كاتب محتوى محترف لشركة في مجال: (اكتب مجالك هنا). اكتب مقال عربي مفيد 600 كلمة. رد بـ JSON فقط بالشكل: {"title":"...","content":"مقال بفقرات HTML","excerpt":"سطرين","social":"بوست قصير يشوّق للمقال","image":"وصف صورة بالإنجليزي بدون كتابة"}',
            prompt: "اكتب مقال الأسبوع بموضوع جديد ومختلف. تاريخ النهاردة: {{$today}}",
            parseJson: true,
            maxTokens: 6000,
          },
        },
        { id: "3", type: "ai.image", position: at(2), params: { prompt: "{{2.json.image}}", size: "1536x1024" } },
        {
          id: "4",
          type: "wordpress.createPost",
          position: at(3),
          params: {
            title: "{{2.json.title}}",
            content: "{{2.json.content}}",
            excerpt: "{{2.json.excerpt}}",
            status: "publish",
            imageUrl: "{{3.url}}",
          },
        },
        { id: "5", type: "linkedin.post", position: at(4, -150), params: { text: "{{2.json.social}}", link: "{{4.link}}", linkTitle: "{{4.title}}" } },
        { id: "6", type: "x.post", position: at(4, 0), params: { text: "{{2.json.social}}\n{{4.link}}" } },
        { id: "7", type: "facebook.post", position: at(4, 150), params: { message: "{{2.json.social}}", link: "{{4.link}}" } },
      ],
      edges: [edge("1", "2"), edge("2", "3"), edge("3", "4"), edge("4", "5"), edge("4", "6"), edge("4", "7")],
    },
  },
  {
    id: "wordpress-post-everywhere",
    name: "مقال جديد على WordPress ← انشره على كل المنصات",
    description: "أول ما تنشر مقال على موقعك، الذكاء الاصطناعي يكتب له بوست مناسب وينزل على تيليجرام و LinkedIn و Bluesky و Threads.",
    category: "سوشيال ميديا",
    requires: ["موقع WordPress", AI_ACCOUNT, "بوت تيليجرام (أدمن في القناة)", "LinkedIn", "Bluesky", "Threads"],
    graph: {
      nodes: [
        { id: "1", type: "wordpress.postTrigger", position: at(0), params: { minutes: 15 } },
        {
          id: "2",
          type: "ai.generate",
          position: at(1),
          params: {
            system: "اكتب بوست سوشيال ميديا قصير (أقل من 250 حرف) بالعربي يشوّق لقراءة المقال، بدون روابط وبدون مقدمات.",
            prompt: "عنوان المقال: {{1.title}}\nملخص: {{1.excerpt}}",
            maxTokens: 800,
          },
        },
        { id: "3", type: "telegram.sendMessage", position: at(2, -225), params: { chatId: "@your_channel", text: "📝 {{1.title}}\n\n{{2.text}}\n\n🔗 {{1.link}}" } },
        { id: "4", type: "linkedin.post", position: at(2, -75), params: { text: "{{2.text}}", link: "{{1.link}}", linkTitle: "{{1.title}}" } },
        { id: "5", type: "bluesky.post", position: at(2, 75), params: { text: "{{2.text}}\n{{1.link}}" } },
        { id: "6", type: "threads.post", position: at(2, 225), params: { text: "{{2.text}}\n{{1.link}}" } },
      ],
      edges: [edge("1", "2"), edge("2", "3"), edge("2", "4"), edge("2", "5"), edge("2", "6")],
    },
  },
  {
    id: "salla-order-whatsapp",
    name: "طلب جديد في سلة ← تأكيد واتساب للعميل + تحديث الحالة",
    description: "مع كل طلب في متجرك على سلة: العميل يستلم رسالة تأكيد على واتساب، والطلب يتحوّل لـ «قيد التنفيذ» تلقائياً.",
    category: "المتاجر الإلكترونية",
    requires: ["متجر سلة (Access Token)", "حساب WasenderAPI"],
    graph: {
      nodes: [
        { id: "1", type: "salla.orderTrigger", position: at(0), params: { minutes: 5 } },
        {
          id: "2",
          type: "wasender.send",
          position: at(1),
          params: {
            to: "{{1.customer.phone}}",
            messageType: "text",
            text: "أهلاً {{1.customer.name}} 👋\nاستلمنا طلبك رقم {{1.reference}} بإجمالي {{1.total}} {{1.currency}}، وبدأنا نجهّزه.\nشكراً لثقتك 🌷",
          },
        },
        { id: "3", type: "salla.updateOrderStatus", position: at(2), params: { orderId: "{{1.id}}", slug: "in_progress" } },
      ],
      edges: [edge("1", "2"), edge("2", "3")],
    },
  },
  {
    id: "zid-order-telegram",
    name: "طلب جديد في زد ← إشعار تيليجرام + واتساب للعميل",
    description: "كل طلب في متجر زد يوصلك على تيليجرام، والعميل يستلم رسالة شكر على واتساب.",
    category: "المتاجر الإلكترونية",
    requires: ["متجر زد", "بوت تيليجرام", "حساب WasenderAPI"],
    graph: {
      nodes: [
        { id: "1", type: "zid.orderTrigger", position: at(0), params: { minutes: 5 } },
        {
          id: "2",
          type: "telegram.sendMessage",
          position: at(1, -90),
          params: { chatId: "", text: "🛒 طلب زد جديد {{1.code}}\nالعميل: {{1.customer.name}} - {{1.customer.phone}}\nالإجمالي: {{1.total}} {{1.currency}}" },
        },
        {
          id: "3",
          type: "wasender.send",
          position: at(1, 90),
          params: { to: "{{1.customer.phone}}", messageType: "text", text: "شكراً {{1.customer.name}} 🌷 طلبك {{1.code}} وصلنا وهنبدأ نجهّزه فوراً." },
        },
      ],
      edges: [edge("1", "2"), edge("1", "3")],
    },
  },
  {
    id: "product-image-pinterest",
    name: "صورة منتج من مكتبتك ← Pin يومي على Pinterest",
    description: "كل يوم بياخد صورة منتج من مكتبة صورك، يكتب لها عنوان ووصف بالذكاء الاصطناعي، وينشرها Pin برابط متجرك.",
    category: "سوشيال ميديا",
    requires: ["صور منتجات في مكتبة الصور", AI_ACCOUNT, "Pinterest"],
    graph: {
      nodes: [
        { id: "1", type: "trigger.schedule", position: at(0), params: { mode: "cron", cron: "0 18 * * *", timezone: "Africa/Cairo" } },
        { id: "2", type: "media.pick", position: at(1), params: { folder: "منتجات", mode: "sequential" } },
        {
          id: "3",
          type: "ai.generate",
          position: at(2),
          params: {
            system: 'اكتب لـ Pinterest. رد بـ JSON فقط: {"title":"عنوان جذاب أقل من 90 حرف","description":"وصف تسويقي بكلمات مفتاحية"}',
            prompt: "اسم المنتج / الصورة: {{2.name}}",
            parseJson: true,
            maxTokens: 800,
          },
        },
        {
          id: "4",
          type: "pinterest.createPin",
          position: at(3),
          params: { boardId: "", imageUrl: "{{2.url}}", title: "{{3.json.title}}", description: "{{3.json.description}}", link: "https://mystore.com" },
        },
      ],
      edges: [edge("1", "2"), edge("2", "3"), edge("3", "4")],
    },
  },

  {
    id: "content-studio-daily",
    name: "استوديو المحتوى اليومي: صور + فيديو + كابشن ← ينزل على كل المنصات في ميعاده",
    description:
      "كل يوم في ميعاد بتحدده: ياخد صورة منتج من مكتبتك، يكتب بوست احترافي بـ CTA وهاشتاجات، يعمل صورة إعلانية و/أو فيديو ريلز، وينشرهم في الساعة اللي تختارها على كل منصة ربطتها بس.",
    category: "المحتوى",
    requires: [
      "صور منتجاتك في مكتبة الصور (فولدر «منتجات»)",
      "حساب Gemini (للنص والصور وفيديو Veo) - أو OpenAI",
      "حسابات المنصات اللي عايز تنشر عليها بس (واللي مش مربوطة بتتخطى)",
    ],
    graph: {
      nodes: [
        { id: "1", type: "trigger.schedule", position: at(0), params: { mode: "cron", cron: "0 10 * * *", timezone: "Africa/Cairo" } },
        {
          id: "2",
          type: "logic.set",
          name: "إعدادات المحتوى",
          position: at(1),
          params: {
            values: [
              { key: "brand", value: "اسم البراند + بتبيع إيه (مثلاً: متجر عطور رجالي فاخر)" },
              { key: "audience", value: "الجمهور (مثلاً: رجال 25-45 في مصر والخليج)" },
              { key: "tone", value: "مصري ودود واحترافي" },
              { key: "ideas", value: "أفكار ولا عروض الفترة دي (مثلاً: خصم 20% لآخر الشهر، هدية مع كل طلب)" },
              { key: "makeImages", value: "نعم" },
              { key: "makeVideos", value: "نعم" },
              { key: "publishAt", value: "19:00" },
              { key: "link", value: "https://mystore.com" },
            ],
          },
        },
        { id: "3", type: "media.pick", name: "صورة المنتج", position: at(2), params: { folder: "منتجات", mode: "sequential" } },
        {
          id: "4",
          type: "ai.generate",
          name: "كتابة المحتوى",
          position: at(3),
          params: {
            system:
              "أنت كاتب محتوى وكوبي رايتر محترف للسوشيال ميديا. اكتب بوست بيع احترافي: جملة افتتاحية تشد (Hook)، فايدة المنتج بإيجاز، CTA واضح (اطلب دلوقتي / ابعتلنا رسالة / الرابط)، و8-12 هاشتاج مناسبين للسوق. ممنوع أي مقدمات. رد بـ JSON فقط بالشكل:\n" +
              '{"post":"البوست كامل بالـ CTA والهاشتاجات","imagePrompt":"English prompt for a professional advertising photo of this exact product, studio lighting, no text on image","videoPrompt":"English prompt for an 8-second cinematic vertical product reel of this exact product, smooth camera motion, no text"}',
            prompt:
              "البراند: {{2.brand}}\nالجمهور: {{2.audience}}\nالأسلوب: {{2.tone}}\nالأفكار والعروض: {{2.ideas}}\nالمنتج (اسم الصورة): {{3.name}}\nالتاريخ: {{$today}}\nاكتب بوست جديد ومختلف عن أي يوم قبل كده.",
            parseJson: true,
            maxTokens: 3000,
          },
        },
        {
          id: "5",
          type: "ai.image",
          name: "صورة إعلانية",
          position: at(4, -90),
          params: { when: "{{2.makeImages}}", prompt: "{{4.json.imagePrompt}}", referenceImage: "{{3.url}}", size: "1024x1280", folder: "مولّدة" },
        },
        {
          id: "6",
          type: "ai.video",
          name: "فيديو ريلز",
          position: at(5, 90),
          params: { when: "{{2.makeVideos}}", prompt: "{{4.json.videoPrompt}}", referenceImage: "{{3.url}}", aspect: "9:16", seconds: 8 },
        },
        {
          id: "7",
          type: "social.publishAll",
          name: "النشر في الميعاد",
          position: at(6),
          params: {
            caption: "{{4.json.post}}",
            imageUrl: "{{5.url}}",
            videoUrl: "{{6.url}}",
            link: "{{2.link}}",
            mediaMode: "both",
            publishAt: "{{2.publishAt}}",
            timezone: "Africa/Cairo",
          },
        },
      ],
      edges: [edge("1", "2"), edge("2", "3"), edge("3", "4"), edge("4", "5"), edge("5", "6"), edge("6", "7")],
    },
  },
  {
    id: "content-studio-form",
    name: "استوديو المحتوى عند الطلب: ارفع صورة المنتج والفكرة ← محتوى كامل ينزل في ميعاده",
    description:
      "فورم بسيط: ترفع صورة المنتج، تكتب الفكرة، تختار صور ولا فيديو ولا الاتنين، وتحدد ساعة النشر. الذكاء الاصطناعي يكتب الكابشن بالـ CTA والهاشتاجات ويعمل الميديا وينشر على المنصات المربوطة.",
    category: "المحتوى",
    requires: ["حساب Gemini (للنص والصور وفيديو Veo) - أو OpenAI", "حسابات المنصات اللي عايز تنشر عليها بس"],
    graph: {
      nodes: [
        {
          id: "1",
          type: "trigger.form",
          position: at(0),
          params: {
            title: "بوست جديد لمنتج",
            description: "ارفع صورة المنتج واكتب الفكرة - والباقي علينا.",
            formFields: [
              { key: "productImage", value: "صورة المنتج (صورة)" },
              { key: "idea", value: "فكرة المحتوى أو العرض" },
              { key: "makeImages", value: "أعمل صورة إعلانية؟ (نعم/لا)" },
              { key: "makeVideos", value: "أعمل فيديو ريلز؟ (نعم/لا)" },
              { key: "publishAt", value: "ميعاد النشر - فاضي = فوراً (ساعة)" },
              { key: "link", value: "رابط المنتج (اختياري)" },
            ],
            submitLabel: "ابدأ",
            successMessage: "استلمنا طلبك ✓ المحتوى بيتعمل وهينزل في ميعاده - تابع النتيجة من «التشغيلات».",
          },
        },
        {
          id: "2",
          type: "ai.generate",
          name: "كتابة المحتوى",
          position: at(1),
          params: {
            system:
              "أنت كاتب محتوى وكوبي رايتر محترف للسوشيال ميديا باللهجة المصرية. اكتب بوست بيع: Hook قوي، فايدة المنتج، CTA واضح، و8-12 هاشتاج. ممنوع أي مقدمات. رد بـ JSON فقط:\n" +
              '{"post":"البوست كامل بالـ CTA والهاشتاجات","imagePrompt":"English prompt for a professional advertising photo of this exact product, no text","videoPrompt":"English prompt for an 8-second cinematic vertical reel of this exact product, no text"}',
            prompt: "الفكرة / العرض: {{1.data.idea}}\nرابط المنتج: {{1.data.link}}",
            parseJson: true,
            maxTokens: 3000,
          },
        },
        {
          id: "3",
          type: "ai.image",
          name: "صورة إعلانية",
          position: at(2, -90),
          params: { when: "{{1.data.makeImages}}", prompt: "{{2.json.imagePrompt}}", referenceImage: "{{1.data.productImage}}", size: "1024x1280" },
        },
        {
          id: "4",
          type: "ai.video",
          name: "فيديو ريلز",
          position: at(3, 90),
          params: { when: "{{1.data.makeVideos}}", prompt: "{{2.json.videoPrompt}}", referenceImage: "{{1.data.productImage}}", aspect: "9:16", seconds: 8 },
        },
        {
          id: "5",
          type: "social.publishAll",
          name: "النشر",
          position: at(4),
          params: {
            caption: "{{2.json.post}}",
            imageUrl: "{{3.url}}",
            videoUrl: "{{4.url}}",
            link: "{{1.data.link}}",
            mediaMode: "both",
            publishAt: "{{1.data.publishAt}}",
            timezone: "Africa/Cairo",
          },
        },
      ],
      edges: [edge("1", "2"), edge("2", "3"), edge("3", "4"), edge("4", "5")],
    },
  },

  {
    id: "gmail-ai-reply",
    name: "إيميل عميل جديد في Gmail ← رد ذكي تلقائي",
    description: "أي إيميل بيوصل لبريدك بعنوان معين، الذكاء الاصطناعي يكتب رد مهذب من معلومات شركتك ويبعته من Gmail.",
    category: "خدمة العملاء",
    requires: ["حساب Gmail (ربط بضغطة)", AI_ACCOUNT],
    graph: {
      nodes: [
        { id: "1", type: "gmail.trigger", position: at(0), params: { query: "in:inbox is:unread -category:promotions", minutes: 10 } },
        {
          id: "2",
          type: "ai.generate",
          position: at(1),
          params: {
            system: "أنت مسؤول خدمة عملاء. اكتب رد إيميل قصير ومهذب بنفس لغة العميل، من المعلومات دي بس: (اكتب معلومات شركتك). لو السؤال برّه المعلومات قول إن فريقنا هيرد خلال 24 ساعة. من غير مقدمات.",
            prompt: "من: {{1.from}}\nالعنوان: {{1.subject}}\n\n{{1.text}}",
            maxTokens: 1500,
          },
        },
        { id: "3", type: "gmail.send", position: at(2), params: { to: "{{1.fromEmail}}", subject: "Re: {{1.subject}}", body: "{{2.text}}", format: "text" } },
      ],
      edges: [edge("1", "2"), edge("2", "3")],
    },
  },
  {
    id: "calendar-whatsapp-reminder",
    name: "ميعاد في Google Calendar ← تذكير واتساب للعميل قبلها بساعة",
    description: "قبل كل حجز أو مكالمة بساعة، العميل يوصله تذكير على واتساب (رقمه مكتوب في وصف الميعاد).",
    category: "خدمة العملاء",
    requires: ["Google Calendar (ربط بضغطة)", "حساب WasenderAPI"],
    graph: {
      nodes: [
        { id: "1", type: "calendar.upcomingTrigger", position: at(0), params: { calendarId: "primary", minutesBefore: 60, minutes: 10 } },
        {
          id: "2",
          type: "tools.text",
          name: "رقم العميل من الوصف",
          position: at(1),
          params: { operation: "extract", text: "{{1.description}}", pattern: "\\d{10,15}" },
        },
        {
          id: "3",
          type: "wasender.send",
          position: at(2),
          params: { to: "{{2.result}}", messageType: "text", text: "تذكير 🔔\nميعادك «{{1.title}}» بعد ساعة.\n{{1.meetLink}}" },
        },
      ],
      edges: [edge("1", "2"), edge("2", "3")],
    },
  },
  {
    id: "drive-video-everywhere",
    name: "فيديو جديد في فولدر Drive ← YouTube Shorts و TikTok وريلز",
    description: "ارفع فيديو في فولدر على Google Drive: الذكاء الاصطناعي يكتب كابشن بهاشتاجات، وينزل على يوتيوب شورتس وتيك توك وإنستجرام ريلز. (شارك الفولدر «أي حد معاه الرابط» عشان المنصات تقدر تسحب الفيديو.)",
    category: "سوشيال ميديا",
    requires: ["Google Drive (ربط بضغطة)", AI_ACCOUNT, "YouTube / TikTok / إنستجرام (اللي عايزه بس)"],
    graph: {
      nodes: [
        { id: "1", type: "drive.trigger", position: at(0), params: { folderId: "", minutes: 15 } },
        {
          id: "2",
          type: "ai.generate",
          position: at(1),
          params: {
            system: "اكتب كابشن قصير جذاب لفيديو قصير بالعربي مع CTA و8 هاشتاجات. من غير مقدمات.",
            prompt: "اسم الفيديو: {{1.name}}",
            maxTokens: 800,
          },
        },
        {
          id: "3",
          type: "social.publishAll",
          position: at(2),
          params: { caption: "{{2.text}}", videoUrl: "https://drive.google.com/uc?export=download&id={{1.id}}", mediaMode: "video" },
        },
      ],
      edges: [edge("1", "2"), edge("2", "3")],
    },
  },

  {
    id: "selected-images-posts",
    name: "بوست لكل صورة تختارها: @الصور ← فكرة كل صورة ← تصميم وكابشن ← نشر",
    description:
      "اختار صور منتجاتك بـ @ واكتب فكرة لكل صورة: كل صورة لوحدها بالترتيب بيتعمل لها تصميم إعلاني وكابشن بـ CTA وهاشتاجات وتتنشر على المنصات اللي ربطتها. (أو صورة واحدة كل تشغيل لو جدولته يومي.)",
    category: "المحتوى",
    requires: ["صورك في مكتبة الصور", "حساب Gemini (للنص والتصميم)", "حسابات المنصات أو خدمة نشر (Upload-Post / Ayrshare ...)"],
    graph: {
      nodes: [
        { id: "1", type: "trigger.manual", position: at(0), params: {} },
        {
          id: "2",
          type: "media.select",
          name: "الصور وأفكارها",
          position: at(1),
          params: { images: "", ideas: "", mode: "each" },
        },
        {
          id: "3",
          type: "ai.generate",
          name: "كتابة البوست",
          position: at(2),
          params: {
            system:
              'أنت كوبي رايتر سوشيال ميديا محترف باللهجة المصرية. اكتب بوست بيع: Hook، فايدة المنتج، CTA واضح، و8-12 هاشتاج. رد بـ JSON فقط: {"post":"البوست كامل","imagePrompt":"English prompt: professional advertising design of this exact product, no text"}',
            prompt: "المنتج: {{2.name}}\nالفكرة: {{2.idea}}",
            parseJson: true,
            maxTokens: 2500,
          },
        },
        {
          id: "4",
          type: "ai.image",
          name: "التصميم",
          position: at(3),
          params: { prompt: "{{3.json.imagePrompt}}", referenceImage: "{{2.url}}", size: "1024x1280" },
        },
        {
          id: "5",
          type: "social.publishAll",
          name: "النشر",
          position: at(4),
          params: { caption: "{{3.json.post}}", imageUrl: "{{4.url}}", mediaMode: "image" },
        },
      ],
      edges: [edge("1", "2"), edge("2", "3"), edge("3", "4"), edge("4", "5")],
    },
  },

  /* ---------- المبيعات وخدمة العملاء ---------- */
  {
    id: "contact-form-telegram",
    name: "فورم الموقع ← إشعار تيليجرام",
    description: "أي حد يملا فورم التواصل في موقعك يوصلك إشعار فوري على تيليجرام.",
    category: "المبيعات والتسويق",
    requires: ["بوت تيليجرام من BotFather"],
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
    id: "lead-qualification",
    name: "تقييم العملاء المحتملين",
    description: "Lead جديد يوصل ← الذكاء الاصطناعي يقيّمه من 10 ← يتحفظ ← لو مهم يوصلك تنبيه.",
    category: "المبيعات والتسويق",
    requires: [AI_ACCOUNT, "بوت تيليجرام (للتنبيهات)"],
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
    id: "support-ticket-triage",
    name: "تصنيف تذاكر الدعم وتنبيه العاجل",
    description: "رسالة دعم توصل ← تتصنف ويتحدد استعجالها ← تتحفظ ← لو عاجلة يوصلك تنبيه.",
    category: "خدمة العملاء",
    requires: [AI_ACCOUNT, "بوت تيليجرام (للتنبيهات)"],
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
    id: "review-auto-reply",
    name: "رد تلقائي على تقييمات العملاء",
    description: "تقييم جديد يوصل ← الذكاء الاصطناعي يحدد رأي العميل ويكتب رد مناسب.",
    category: "خدمة العملاء",
    requires: [AI_ACCOUNT],
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

  /* ---------- أدوات ومحتوى ---------- */
  {
    id: "ai-summary-api",
    name: "API تلخيص نصوص",
    description: "ابعت نص على Webhook، يرجعلك ملخص في نفس الطلب. تقدر تربطه بموقعك أو تبيعه كخدمة.",
    category: "أدوات",
    requires: [AI_ACCOUNT],
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
    category: "أدوات",
    requires: [AI_ACCOUNT],
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
    id: "daily-ai-report",
    name: "تقرير يومي بالذكاء الاصطناعي",
    description: "كل يوم الصبح يجيب بيانات من أي API، يلخصها في تقرير، ويبعتها لك على تيليجرام.",
    category: "أدوات",
    requires: [AI_ACCOUNT, "بوت تيليجرام", "رابط API فيه بياناتك"],
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
    category: "أدوات",
    requires: ["بوت تيليجرام"],
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
