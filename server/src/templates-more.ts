import type { Template } from "./templates.js";

/* The most-used everyday automations (sheets, forms, chat, stores, content), built on our own steps. */

const edge = (source: string, target: string) => ({ id: `e${source}-${target}`, source, target, sourceHandle: null });
const at = (x: number, y = 0) => ({ x: x * 280, y });
const chain = (...ids: string[]) => ids.slice(1).map((id, i) => edge(ids[i], id));

const AI_ACCOUNT = "حساب ذكاء اصطناعي: Gemini (فيه باقة مجانية) أو ChatGPT أو Claude - أو أي مزوّد تاني عندك مفتاحه";
const SHEETS = (columns: string) => `Google Sheets (Service Account) - أول صف فيه عناوين الأعمدة: ${columns}`;
const SHEET_OUT = "Google Sheets (Service Account) والشيت مشارك مع إيميل المفتاح";

export const moreTemplates: Template[] = [
  /* ---------- Google Sheets ---------- */
  {
    id: "sheets-ai-completions",
    name: "صف جديد في Google Sheets ← رد بالذكاء الاصطناعي في شيت النتائج",
    description: "كل سؤال أو طلب تكتبه في الشيت، الذكاء الاصطناعي يرد عليه ويحفظ الرد في شيت تاني. مناسب لكتابة وصف منتجات أو ردود أو أفكار بالجملة.",
    category: "أدوات",
    requires: [SHEETS("الطلب"), AI_ACCOUNT],
    graph: {
      nodes: [
        { id: "1", type: "sheets.trigger", position: at(0), params: { spreadsheetId: "", sheet: "Sheet1", minutes: 15 } },
        { id: "2", type: "ai.generate", position: at(1), params: { system: "رد بشكل مختصر ومفيد باللهجة المصرية.", prompt: "{{1.الطلب}}" } },
        { id: "3", type: "sheets.append", position: at(2), params: { spreadsheetId: "", sheet: "النتائج", row: '["{{1.الطلب}}", "{{2.text}}", "{{$now}}"]' } },
      ],
      edges: chain("1", "2", "3"),
    },
  },
  {
    id: "webhook-to-sheets",
    name: "بيانات من أي موقع (Webhook) ← صف في Google Sheets",
    description: "ابعت أي بيانات لرابط الـ Webhook من موقعك أو أي خدمة، وتتسجل صف جديد في الشيت فوراً.",
    category: "أدوات",
    requires: [SHEET_OUT],
    graph: {
      nodes: [
        { id: "1", type: "trigger.webhook", position: at(0), params: {} },
        { id: "2", type: "sheets.append", position: at(1), params: { spreadsheetId: "", sheet: "Sheet1", row: '["{{1.body.name}}", "{{1.body.email}}", "{{1.body.phone}}", "{{$now}}"]' } },
        { id: "3", type: "logic.respond", position: at(2), params: { status: 200, bodyType: "json", jsonBody: '{ "saved": true }' } },
      ],
      edges: chain("1", "2", "3"),
    },
  },
  {
    id: "sheets-row-email",
    name: "صف جديد في Google Sheets ← إيميل تلقائي (Gmail)",
    description: "أول ما يتضاف صف جديد (عميل، طلب، ميعاد) يوصل لصاحبه إيميل من حسابك على Gmail.",
    category: "المبيعات والتسويق",
    requires: [SHEETS("الاسم، الإيميل"), "حساب إيميل (Gmail App Password أو SMTP)"],
    graph: {
      nodes: [
        { id: "1", type: "sheets.trigger", position: at(0), params: { spreadsheetId: "", sheet: "Sheet1", minutes: 15 } },
        {
          id: "2",
          type: "email.smtpSend",
          position: at(1),
          params: { to: "{{1.الإيميل}}", subject: "أهلاً {{1.الاسم}}", body: "أهلاً {{1.الاسم}},\n\nشكراً لتواصلك معانا، هنكلمك في أقرب وقت.", format: "text" },
        },
      ],
      edges: chain("1", "2"),
    },
  },
  {
    id: "sheets-row-telegram",
    name: "صف جديد في Google Sheets ← رسالة تيليجرام",
    description: "إشعار فوري على تيليجرام بكل صف جديد في الشيت (طلب، حجز، عميل جديد).",
    category: "تيليجرام",
    requires: [SHEETS("الاسم، التفاصيل"), "بوت تيليجرام + الـ Chat ID بتاعك"],
    graph: {
      nodes: [
        { id: "1", type: "sheets.trigger", position: at(0), params: { spreadsheetId: "", sheet: "Sheet1", minutes: 15 } },
        { id: "2", type: "telegram.sendMessage", position: at(1), params: { chatId: "", text: "🆕 صف جديد في الشيت\nالاسم: {{1.الاسم}}\nالتفاصيل: {{1.التفاصيل}}" } },
      ],
      edges: chain("1", "2"),
    },
  },
  {
    id: "sheets-row-slack",
    name: "صف جديد في Google Sheets ← رسالة Slack للفريق",
    description: "كل صف جديد يتبعت كرسالة في قناة Slack عشان الفريق يتابع أول بأول.",
    category: "أدوات",
    requires: [SHEETS("الاسم، التفاصيل"), "بوت Slack"],
    graph: {
      nodes: [
        { id: "1", type: "sheets.trigger", position: at(0), params: { spreadsheetId: "", sheet: "Sheet1", minutes: 15 } },
        { id: "2", type: "slack.message", position: at(1), params: { channel: "#general", text: "🆕 {{1.الاسم}}: {{1.التفاصيل}}" } },
      ],
      edges: chain("1", "2"),
    },
  },
  {
    id: "sheets-row-notion",
    name: "صف جديد في Google Sheets ← صفحة في Notion",
    description: "كل صف جديد في الشيت يتحول لعنصر في قاعدة بيانات Notion.",
    category: "أدوات",
    requires: [SHEETS("العنوان، التفاصيل"), "Notion (Internal integration token) والقاعدة مشاركة معاه"],
    graph: {
      nodes: [
        { id: "1", type: "sheets.trigger", position: at(0), params: { spreadsheetId: "", sheet: "Sheet1", minutes: 15 } },
        { id: "2", type: "notion.createPage", position: at(1), params: { databaseId: "", titleProperty: "Name", title: "{{1.العنوان}}", content: "{{1.التفاصيل}}" } },
      ],
      edges: chain("1", "2"),
    },
  },
  {
    id: "sheets-row-calendar",
    name: "مواعيد من Google Sheets ← أحداث في Google Calendar",
    description: "كل ميعاد تكتبه في الشيت يتضاف حدث في التقويم بالمدة اللي تحددها.",
    category: "أدوات",
    requires: [SHEETS("العنوان، الميعاد (مثلاً 2026-10-01 15:00)"), "مفتاح Google (Service Account) والتقويم مشارك معاه"],
    graph: {
      nodes: [
        { id: "1", type: "sheets.trigger", position: at(0), params: { spreadsheetId: "", sheet: "Sheet1", minutes: 15 } },
        {
          id: "2",
          type: "calendar.createEvent",
          position: at(1),
          params: { calendarId: "", title: "{{1.العنوان}}", start: "{{1.الميعاد}}", durationMinutes: 60, timezone: "Africa/Cairo" },
        },
      ],
      edges: chain("1", "2"),
    },
  },
  {
    id: "sheets-row-trello",
    name: "مهمة جديدة في Google Sheets ← كارت Trello",
    description: "كل مهمة تتكتب في الشيت تتحول لكارت في القائمة اللي تختارها على Trello.",
    category: "أدوات",
    requires: [SHEETS("المهمة، التفاصيل"), "Trello (API Key + Token)"],
    graph: {
      nodes: [
        { id: "1", type: "sheets.trigger", position: at(0), params: { spreadsheetId: "", sheet: "Sheet1", minutes: 15 } },
        { id: "2", type: "trello.card", position: at(1), params: { listId: "", name: "{{1.المهمة}}", desc: "{{1.التفاصيل}}" } },
      ],
      edges: chain("1", "2"),
    },
  },
  {
    id: "sheets-row-instagram",
    name: "صف جديد في Google Sheets ← بوست إنستجرام",
    description: "جهّز البوستات في الشيت (رابط الصورة والكابشن) وكل صف جديد ينزل بوست على إنستجرام.",
    category: "سوشيال ميديا",
    requires: [SHEETS("الصورة (رابط)، الكابشن"), "إنستجرام بزنس (توكن)"],
    graph: {
      nodes: [
        { id: "1", type: "sheets.trigger", position: at(0), params: { spreadsheetId: "", sheet: "Sheet1", minutes: 15 } },
        { id: "2", type: "instagram.post", position: at(1), params: { imageUrl: "{{1.الصورة}}", caption: "{{1.الكابشن}}" } },
      ],
      edges: chain("1", "2"),
    },
  },
  {
    id: "webhook-ai-sheets",
    name: "بيانات من Webhook ← تحليل بالذكاء الاصطناعي ← Google Sheets",
    description: "أي رسالة أو طلب يوصل للرابط، الذكاء الاصطناعي يلخّصه ويصنّفه، والنتيجة تتسجل في الشيت.",
    category: "أدوات",
    requires: [AI_ACCOUNT, SHEET_OUT],
    graph: {
      nodes: [
        { id: "1", type: "trigger.webhook", position: at(0), params: {} },
        {
          id: "2",
          type: "ai.generate",
          position: at(1),
          params: {
            system: 'رجّع JSON بس بالشكل: {"summary": "ملخص في سطر", "category": "استفسار أو شكوى أو طلب"}',
            prompt: "{{1.body.message}}",
            parseJson: true,
          },
        },
        {
          id: "3",
          type: "sheets.append",
          position: at(2),
          params: { spreadsheetId: "", sheet: "Sheet1", row: '["{{1.body.message}}", "{{2.json.summary}}", "{{2.json.category}}", "{{$now}}"]' },
        },
      ],
      edges: chain("1", "2", "3"),
    },
  },

  /* ---------- Chat ---------- */
  {
    id: "telegram-to-sheets",
    name: "رسايل تيليجرام ← Google Sheets",
    description: "كل رسالة توصل للبوت تتسجل في الشيت بالاسم والنص والوقت.",
    category: "تيليجرام",
    requires: ["بوت تيليجرام", SHEET_OUT],
    graph: {
      nodes: [
        { id: "1", type: "telegram.trigger", position: at(0), params: { updateType: "message" } },
        {
          id: "2",
          type: "sheets.append",
          position: at(1),
          params: { spreadsheetId: "", sheet: "Sheet1", row: '["{{1.message.from.first_name}}", "{{1.message.chat.id}}", "{{1.message.text}}", "{{$now}}"]' },
        },
      ],
      edges: chain("1", "2"),
    },
  },
  {
    id: "whatsapp-to-sheets",
    name: "رسايل واتساب ← Google Sheets",
    description: "كل رسالة واتساب توصل على رقمك تتسجل في الشيت: الاسم، الرقم، الرسالة، الوقت.",
    category: "واتساب",
    requires: ["حساب WasenderAPI", SHEET_OUT],
    graph: {
      nodes: [
        { id: "1", type: "wasender.trigger", position: at(0), params: { eventType: "messages.received", ignoreGroups: true } },
        { id: "2", type: "sheets.append", position: at(1), params: { spreadsheetId: "", sheet: "Sheet1", row: '["{{1.pushName}}", "{{1.phone}}", "{{1.text}}", "{{$now}}"]' } },
      ],
      edges: chain("1", "2"),
    },
  },
  {
    id: "telegram-to-discord",
    name: "رسايل تيليجرام ← قناة Discord",
    description: "أي رسالة توصل للبوت أو الجروب على تيليجرام تتنقل لقناة Discord.",
    category: "تيليجرام",
    requires: ["بوت تيليجرام", "Discord Webhook"],
    graph: {
      nodes: [
        { id: "1", type: "telegram.trigger", position: at(0), params: { updateType: "message" } },
        { id: "2", type: "discord.message", position: at(1), params: { content: "**{{1.message.from.first_name}}**: {{1.message.text}}", username: "تيليجرام" } },
      ],
      edges: chain("1", "2"),
    },
  },
  {
    id: "weather-telegram-daily",
    name: "توقعات الطقس بكرة ← رسالة تيليجرام كل يوم",
    description: "كل يوم بالليل يجيب توقعات طقس بكرة لمدينتك (خدمة مجانية من غير مفتاح) ويبعتها لك على تيليجرام.",
    category: "تيليجرام",
    requires: ["بوت تيليجرام + الـ Chat ID بتاعك"],
    graph: {
      nodes: [
        { id: "1", type: "trigger.schedule", position: at(0), params: { mode: "daily", time: "21:00", timezone: "Africa/Cairo" } },
        {
          id: "2",
          type: "http.request",
          position: at(1),
          params: {
            method: "GET",
            url: "https://api.open-meteo.com/v1/forecast?latitude=30.04&longitude=31.24&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Africa%2FCairo&forecast_days=2",
          },
        },
        {
          id: "3",
          type: "telegram.sendMessage",
          position: at(2),
          params: {
            chatId: "",
            text: "🌤️ طقس بكرة في القاهرة\nالعظمى: {{2.data.daily.temperature_2m_max[1]}}°\nالصغرى: {{2.data.daily.temperature_2m_min[1]}}°\nاحتمال مطر: {{2.data.daily.precipitation_probability_max[1]}}%",
          },
        },
      ],
      edges: chain("1", "2", "3"),
    },
  },

  /* ---------- Forms ---------- */
  {
    id: "form-to-notion",
    name: "فورم ← عنصر جديد في Notion",
    description: "ردود الفورم (طلبات، اقتراحات، تسجيلات) تتسجل مباشرة في قاعدة بيانات Notion.",
    category: "أدوات",
    requires: ["Notion (Internal integration token) والقاعدة مشاركة معاه"],
    graph: {
      nodes: [
        {
          id: "1",
          type: "trigger.form",
          position: at(0),
          params: {
            title: "ابعت طلبك",
            formFields: [
              { key: "name", value: "الاسم" },
              { key: "request", value: "الطلب" },
            ],
            submitLabel: "إرسال",
            successMessage: "وصلنا طلبك ✓",
          },
        },
        { id: "2", type: "notion.createPage", position: at(1), params: { databaseId: "", titleProperty: "Name", title: "{{1.data.name}}", content: "{{1.data.request}}" } },
      ],
      edges: chain("1", "2"),
    },
  },
  {
    id: "form-mailchimp-welcome",
    name: "فورم اشتراك ← قائمة Mailchimp + إيميل ترحيب",
    description: "اللي يشترك من الفورم يتضاف لقائمتك على Mailchimp ويوصله إيميل ترحيب من حسابك.",
    category: "المبيعات والتسويق",
    requires: ["Mailchimp (API Key)", "حساب إيميل (Gmail App Password أو SMTP)"],
    graph: {
      nodes: [
        {
          id: "1",
          type: "trigger.form",
          position: at(0),
          params: {
            title: "اشترك في النشرة",
            formFields: [
              { key: "name", value: "الاسم" },
              { key: "email", value: "الإيميل" },
            ],
            submitLabel: "اشترك",
            successMessage: "تم الاشتراك ✓",
          },
        },
        { id: "2", type: "mailchimp.subscribe", position: at(1), params: { listId: "", email: "{{1.data.email}}", firstName: "{{1.data.name}}", tags: "من الفورم" } },
        {
          id: "3",
          type: "email.smtpSend",
          position: at(2),
          params: { to: "{{1.data.email}}", subject: "أهلاً بيك في النشرة", body: "أهلاً {{1.data.name}},\n\nشكراً لاشتراكك! هيوصلك مننا كل جديد.", format: "text" },
        },
      ],
      edges: chain("1", "2", "3"),
    },
  },
  {
    id: "website-to-social-posts",
    name: "رابط أي صفحة ← ملخص وبوستات سوشيال بالذكاء الاصطناعي",
    description: "حط رابط مقال أو صفحة منتج في الفورم، المنصة تقرأ الصفحة والذكاء الاصطناعي يكتب منها بوستات جاهزة للنشر.",
    category: "المحتوى",
    requires: [AI_ACCOUNT],
    graph: {
      nodes: [
        {
          id: "1",
          type: "trigger.form",
          position: at(0),
          params: { title: "رابط الصفحة", formFields: [{ key: "url", value: "رابط الصفحة" }], submitLabel: "اكتب البوستات", successMessage: "البوستات جاهزة ✓" },
        },
        { id: "2", type: "http.request", position: at(1), params: { method: "GET", url: "{{1.data.url}}", failOnError: true } },
        {
          id: "3",
          type: "ai.generate",
          position: at(2),
          params: {
            system: "أنت كاتب محتوى سوشيال ميديا محترف. اكتب بالعربي بلهجة مصرية خفيفة، مع CTA وهاشتاجات.",
            prompt: "دي محتويات صفحة (HTML). لخّصها في سطرين، وبعدين اكتب 3 بوستات مختلفة (فيسبوك، إنستجرام، لينكدإن):\n\n{{2.data}}",
          },
        },
        { id: "4", type: "logic.respond", position: at(3), params: { status: 200, bodyType: "json", jsonBody: '{ "text": "{{3.text}}" }' } },
      ],
      edges: chain("1", "2", "3", "4"),
    },
  },

  /* ---------- Content ---------- */
  {
    id: "rss-to-linkedin",
    name: "مقال جديد في RSS ← بوست LinkedIn بالذكاء الاصطناعي",
    description: "كل مقال جديد في المدونة أو الموقع اللي بتتابعه، الذكاء الاصطناعي يكتب عنه بوست احترافي وينزل على LinkedIn.",
    category: "المحتوى",
    requires: ["رابط RSS", AI_ACCOUNT, "LinkedIn (Access Token)"],
    graph: {
      nodes: [
        { id: "1", type: "rss.trigger", position: at(0), params: { url: "", minutes: 30 } },
        {
          id: "2",
          type: "ai.generate",
          position: at(1),
          params: { system: "اكتب بوست LinkedIn احترافي قصير بالعربي، بجملة افتتاحية قوية و3 هاشتاجات.", prompt: "العنوان: {{1.title}}\nالملخص: {{1.description}}" },
        },
        { id: "3", type: "linkedin.post", position: at(2), params: { text: "{{2.text}}", link: "{{1.link}}", linkTitle: "{{1.title}}" } },
      ],
      edges: chain("1", "2", "3"),
    },
  },
  {
    id: "rss-to-notion",
    name: "مقالات RSS ← قاعدة بيانات Notion",
    description: "كل مقال جديد يتسجل في Notion بالعنوان والرابط والملخص عشان ترجعله بعدين.",
    category: "المحتوى",
    requires: ["رابط RSS", "Notion (Internal integration token)"],
    graph: {
      nodes: [
        { id: "1", type: "rss.trigger", position: at(0), params: { url: "", minutes: 60 } },
        { id: "2", type: "notion.createPage", position: at(1), params: { databaseId: "", titleProperty: "Name", title: "{{1.title}}", content: "{{1.link}}\n\n{{1.description}}" } },
      ],
      edges: chain("1", "2"),
    },
  },
  {
    id: "weekly-linkedin-ai",
    name: "بوست LinkedIn أسبوعي بالذكاء الاصطناعي",
    description: "كل أسبوع الذكاء الاصطناعي يكتب بوست عن مجالك (نصيحة، معلومة، قصة) وينزل على LinkedIn.",
    category: "المحتوى",
    requires: [AI_ACCOUNT, "LinkedIn (Access Token)"],
    graph: {
      nodes: [
        { id: "1", type: "trigger.schedule", position: at(0), params: { mode: "weekly", days: ["0"], time: "10:00", timezone: "Africa/Cairo" } },
        {
          id: "2",
          type: "ai.generate",
          position: at(1),
          params: {
            system: "أنت خبير في [مجالك]. اكتب بوست LinkedIn عملي ومختصر بالعربي فيه نصيحة واحدة واضحة، ومن غير تكرار أفكار عامة.",
            prompt: "اكتب بوست الأسبوع. التاريخ: {{$now}}",
          },
        },
        { id: "3", type: "linkedin.post", position: at(2), params: { text: "{{2.text}}" } },
      ],
      edges: chain("1", "2", "3"),
    },
  },
  {
    id: "product-description-writer",
    name: "كاتب وصف منتجات بالذكاء الاصطناعي",
    description: "اكتب اسم المنتج ومميزاته في الفورم، يطلعلك وصف بيع احترافي وعنوان SEO، ويتحفظ في الشيت.",
    category: "المتاجر الإلكترونية",
    requires: [AI_ACCOUNT, SHEET_OUT],
    graph: {
      nodes: [
        {
          id: "1",
          type: "trigger.form",
          position: at(0),
          params: {
            title: "وصف منتج",
            formFields: [
              { key: "product", value: "اسم المنتج" },
              { key: "features", value: "المميزات" },
            ],
            submitLabel: "اكتب الوصف",
            successMessage: "الوصف جاهز ✓",
          },
        },
        {
          id: "2",
          type: "ai.generate",
          position: at(1),
          params: {
            system: 'أنت كاتب إعلانات لمتاجر إلكترونية. رجّع JSON بس: {"title": "عنوان SEO", "description": "وصف بيع مقنع من 80 كلمة"}',
            prompt: "المنتج: {{1.data.product}}\nالمميزات: {{1.data.features}}",
            parseJson: true,
          },
        },
        {
          id: "3",
          type: "sheets.append",
          position: at(2),
          params: { spreadsheetId: "", sheet: "Sheet1", row: '["{{1.data.product}}", "{{2.json.title}}", "{{2.json.description}}"]' },
        },
        { id: "4", type: "logic.respond", position: at(3), params: { status: 200, bodyType: "json", jsonBody: '{ "title": "{{2.json.title}}", "description": "{{2.json.description}}" }' } },
      ],
      edges: chain("1", "2", "3", "4"),
    },
  },

  /* ---------- Stores & payments ---------- */
  {
    id: "shopify-orders-sheets",
    name: "طلبات Shopify المدفوعة ← Google Sheets",
    description: "كل طلب جديد على Shopify يتسجل في الشيت: رقم الطلب، العميل، الإجمالي، الحالة.",
    category: "المتاجر الإلكترونية",
    requires: ["Shopify (Admin API token)", SHEET_OUT],
    graph: {
      nodes: [
        { id: "1", type: "shopify.orderTrigger", position: at(0), params: { minutes: 15 } },
        {
          id: "2",
          type: "sheets.append",
          position: at(1),
          params: { spreadsheetId: "", sheet: "Sheet1", row: '["{{1.name}}", "{{1.customer.name}}", "{{1.customer.email}}", "{{1.total}} {{1.currency}}", "{{1.financialStatus}}"]' },
        },
      ],
      edges: chain("1", "2"),
    },
  },
  {
    id: "woocommerce-orders-sheets",
    name: "طلبات WooCommerce ← Google Sheets",
    description: "كل طلب جديد في متجرك على WordPress يتسجل في الشيت بتفاصيله.",
    category: "المتاجر الإلكترونية",
    requires: ["WooCommerce (Consumer key/secret)", SHEET_OUT],
    graph: {
      nodes: [
        { id: "1", type: "woocommerce.orderTrigger", position: at(0), params: { minutes: 15 } },
        {
          id: "2",
          type: "sheets.append",
          position: at(1),
          params: { spreadsheetId: "", sheet: "Sheet1", row: '["{{1.id}}", "{{1.customer.name}}", "{{1.customer.phone}}", "{{1.total}} {{1.currency}}", "{{1.status}}"]' },
        },
      ],
      edges: chain("1", "2"),
    },
  },
  {
    id: "stripe-payments-sheets",
    name: "مدفوعات Stripe ← Google Sheets",
    description: "كل دفعة ناجحة تتسجل في الشيت، عشان حساباتك تبقى محدّثة لوحدها.",
    category: "المبيعات والتسويق",
    requires: ["Stripe (Secret key)", SHEET_OUT],
    graph: {
      nodes: [
        { id: "1", type: "stripe.paymentTrigger", position: at(0), params: { minutes: 15 } },
        {
          id: "2",
          type: "sheets.append",
          position: at(1),
          params: { spreadsheetId: "", sheet: "Sheet1", row: '["{{1.customer.name}}", "{{1.customer.email}}", "{{1.amount}} {{1.currency}}", "{{1.createdAt}}"]' },
        },
      ],
      edges: chain("1", "2"),
    },
  },
  {
    id: "airtable-record-telegram",
    name: "سجل جديد في Airtable ← رسالة تيليجرام",
    description: "إشعار على تيليجرام بكل سجل جديد في جدول Airtable.",
    category: "تيليجرام",
    requires: ["Airtable (Personal access token)", "بوت تيليجرام + الـ Chat ID بتاعك"],
    graph: {
      nodes: [
        { id: "1", type: "airtable.trigger", position: at(0), params: { baseId: "", table: "", minutes: 15 } },
        { id: "2", type: "telegram.sendMessage", position: at(1), params: { chatId: "", text: "🆕 سجل جديد في Airtable: {{1.Name}}" } },
      ],
      edges: chain("1", "2"),
    },
  },
  {
    id: "calendar-events-slack",
    name: "مواعيد Google Calendar ← تنبيه في Slack",
    description: "قبل كل ميعاد في التقويم بنص ساعة، الفريق يوصله تنبيه في Slack.",
    category: "أدوات",
    requires: ["مفتاح Google (Service Account) والتقويم مشارك معاه", "بوت Slack"],
    graph: {
      nodes: [
        { id: "1", type: "calendar.upcomingTrigger", position: at(0), params: { calendarId: "", minutesBefore: 30, minutes: 10 } },
        { id: "2", type: "slack.message", position: at(1), params: { channel: "#general", text: "⏰ بعد شوية: {{1.title}} - {{1.start}}" } },
      ],
      edges: chain("1", "2"),
    },
  },
  {
    id: "http-json-parse",
    name: "اقرأ بيانات من أي API وحلّلها (JSON)",
    description: "مثال بسيط: طلب HTTP لأي API، وقراءة النتيجة كـ JSON عشان تستخدم قيمها في الخطوات اللي بعدها.",
    category: "أدوات",
    requires: [],
    graph: {
      nodes: [
        { id: "1", type: "trigger.manual", position: at(0), params: {} },
        { id: "2", type: "http.request", position: at(1), params: { method: "GET", url: "https://api.github.com/repos/nodejs/node" } },
        { id: "3", type: "tools.json", position: at(2), params: { operation: "stringify", input: "{{2.data}}" } },
      ],
      edges: chain("1", "2", "3"),
    },
  },
];
