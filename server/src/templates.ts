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

const AI_ACCOUNT = "حساب ذكاء اصطناعي: Gemini (فيه باقة مجانية) أو ChatGPT أو Claude";
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
          params: { prompt: "صورة احترافية لبوست سوشيال ميديا عن: {{1.data.topic}}، بدون كتابة على الصورة", size: "1024x1024" },
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
        { id: "3", type: "ai.image", position: at(2), params: { prompt: "{{2.json.image}}", size: "1024x1024" } },
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
        { id: "2", type: "ai.image", position: at(1), params: { prompt: "{{1.data.idea}}", size: "1024x1024", folder: "مولّدة" } },
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
            size: "1024x1024",
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
