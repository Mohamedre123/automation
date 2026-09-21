import type { Template } from "./templates.js";

/*
 * The jobs a small business pays a person to do every day - each one as a whole scenario,
 * not a sketch. They all follow the same shape on purpose:
 *
 *   متى؟  ->  بيانات المشروع / الطلب  ->  الذكاء الاصطناعي يشتغل  ->  النتيجة تتسجّل وتتبعتلك
 *
 * You fill the one step that describes your business, pick the accounts, and that is it.
 */

const edge = (source: string, target: string, sourceHandle: string | null = null) => ({
  id: `e${source}-${target}${sourceHandle ? `-${sourceHandle}` : ""}`,
  source,
  target,
  sourceHandle,
});
const at = (x: number, y = 0) => ({ x: x * 280, y });
const chain = (...ids: string[]) => ids.slice(1).map((id, i) => edge(ids[i], id));

const AI = "حساب ذكاء اصطناعي: Gemini (فيه باقة مجانية) أو ChatGPT أو Claude";
const AI_SEARCH = "حساب ذكاء اصطناعي بيقدر يبحث في النت: Gemini أو ChatGPT أو Claude";
const WHATSAPP = "واتساب (WasenderAPI بالـ QR، أو واتساب الرسمي) - عشان النتيجة توصلك";
const SHEET = (columns: string) => `Google Sheets (Service Account) وشيت أول صف فيه الأعمدة دي: ${columns}`;

export const workTemplates: Template[] = [
  /* ------------------------------------------------------------------ *
   * The one the owner asked for: a competitor analyst that works while
   * nobody is watching and hands in a finished report.
   * ------------------------------------------------------------------ */
  {
    id: "competitor-watch",
    name: "محلل المنافسين: بحث وتقرير كامل يوصلك على واتساب",
    description:
      "املا بيانات مشروعك ومنافسينك مرة واحدة، وحدد الميعاد. كل مرة الذكاء الاصطناعي بيدوّر في النت بنفسه على أسعارهم وعروضهم وجديدهم، ويطلّع تقرير فيه مقارنة بالجدول ونقط قوة وضعف كل منافس وفرص انت تكسب منها وخطة 30 يوم - ويبعتلك الرابط على واتساب",
    category: "شغل يومي",
    requires: [AI_SEARCH, WHATSAPP, "رقم واتساب بتاعك انت عشان التقرير يوصله"],
    graph: {
      nodes: [
        {
          id: "1",
          type: "trigger.schedule",
          name: "كل أسبوع",
          position: at(0),
          params: { mode: "weekly", time: "09:00", days: ["0"], timezone: "Africa/Cairo" },
        },
        {
          id: "2",
          type: "core.brief",
          name: "مشروعك ومنافسينك",
          position: at(1),
          params: {
            business: "",
            offer: "",
            audience: "",
            market: "مصر",
            competitors: "",
            goal: "عايز أعرف أسعارهم وعروضهم، وإيه اللي بيميزهم، وفين الفرصة اللي أقدر أسبقهم بيها",
            notes: "",
          },
        },
        {
          id: "3",
          type: "ai.generate",
          name: "البحث في النت",
          position: at(2),
          params: {
            search: true,
            system:
              "أنت باحث سوق محترف. شغلك تجمع حقائق من النت عن منافسين محددين - مش تحلل ومش تتوقع.\n\n" +
              "# قواعد صارمة\n" +
              "- ابحث فعلاً عن كل منافس بالاسم، ولو معاك رابط افتحه واقرا اللي فيه.\n" +
              "- اكتب الحقيقة اللي لقيتها بس. أي رقم أو سعر لازم تكون لقيته فعلاً - لو ملقتوش اكتب «مش لاقيه».\n" +
              "- ممنوع تخمّن أسعار أو أرقام متابعين أو تفاصيل من عندك.\n" +
              "- حط لينك المصدر جنب كل معلومة مهمة.\n" +
              "- لو منافس ملقتش عنه حاجة خالص، قول كده صريح بدل ما تكتب كلام عام.\n\n" +
              "# اجمع عن كل منافس الحاجات دي بالتفصيل\n" +
              "1. المنتجات أو الخدمات: إيه بالظبط بيبيع، والأصناف، وإيه المنتج اللي بيركز عليه.\n" +
              "2. الأسعار: أقل وأعلى سعر لقيته، وأسعار أشهر المنتجات، وسياسة الشحن والدفع.\n" +
              "3. العروض الحالية: خصومات، باقات، شحن مجاني، ضمان، استرجاع.\n" +
              "4. الموقع الإلكتروني: فيه إيه، سهل ولا لأ، بيبيع أونلاين ولا بيحوّل على واتساب، سرعة الرد.\n" +
              "5. السوشيال ميديا: على أنهي منصات، عدد المتابعين لو ظاهر، بينزل كام مرة، نوع المحتوى (صور منتجات؟ ريلز؟ عروض؟)، وأكتر بوست تفاعل عليه.\n" +
              "6. رأي العملاء: التقييمات والتعليقات - بيمدحوا إيه وبيشتكوا من إيه بالظبط.\n" +
              "7. طريقة كلامهم: نبرة الكلام والرسالة اللي بيكرروها، والكلمات اللي بيستخدموها.\n" +
              "8. الجديد: أي حاجة اتغيرت آخر تلات شهور - منتج جديد، حملة، تغيير أسعار.\n\n" +
              "اكتب النتايج تحت اسم كل منافس، وتحت كل رقم من اللي فوق عنوان صغير، ومعاها المصادر.",
            prompt:
              "دوّر على المنافسين دول في السوق المحدد واجمع عنهم كل اللي تقدر:\n\n{{2.text}}\n\n" +
              "لو منافس مالوش اسم واضح، دوّر على أشهر المنافسين في نفس المجال والسوق ده واشتغل عليهم.\n" +
              "اكتب النتايج منظمة تحت اسم كل منافس، ومعاها المصادر.",
            maxTokens: 20000,
          },
        },
        {
          id: "4",
          type: "ai.generate",
          name: "كتابة التقرير",
          position: at(3),
          params: {
            system:
              "أنت مستشار تسويق بيكتب تقرير مفصّل لصاحب مشروع صغير - بالعامية المصرية الواضحة، من غير مصطلحات فاضية.\n" +
              "التقرير ده المفروض يبقى حاجة يقعد يقراها ويشتغل بيها، مش ملخص. اكتب بالترتيب ده بالظبط، بصيغة Markdown:\n\n" +
              "## الخلاصة في نص دقيقة\n" +
              "من 4 لـ 6 نقط: أهم حاجة لازم يعرفها دلوقتي، وكل نقطة معاها الرقم أو الدليل اللي وراها.\n\n" +
              "## مقارنة سريعة\n" +
              "جدول أعمدته: المنافس | بيبيع إيه | نطاق السعر | أقوى حاجة عنده | أضعف حاجة عنده\n" +
              "وحط مشروع العميل نفسه في أول صف عشان المقارنة تبان.\n\n" +
              "## الأسعار\n" +
              "جدول أعمدته: المنافس | أرخص حاجة | أغلى حاجة | الشحن | العروض دلوقتي\n" +
              "وتحته فقرة: انت واقف فين من السوق، وغالي ولا رخيص ليه.\n\n" +
              "## السوشيال ميديا\n" +
              "جدول أعمدته: المنافس | المنصات | بينزل قد إيه | نوع المحتوى | إيه اللي بيتفاعل عنده\n" +
              "وتحته فقرة: إيه اللي بينجح معاهم وانت متعملوش.\n\n" +
              "## المواقع والتجربة\n" +
              "لكل منافس سطرين: موقعه بيعمل إيه كويس، وإيه اللي وحش فيه - وإيه اللي تاخده منه لموقعك.\n\n" +
              "## العملاء بيقولوا إيه\n" +
              "اللي بيمدحوه واللي بيشتكوا منه، وكل شكوى دي فرصة ليك إزاي.\n\n" +
              "## كل منافس بالتفصيل\n" +
              "لكل واحد عنوان فرعي (### اسمه) وتحته: نقط قوة، نقط ضعف، وإيه اللي نتعلمه منه.\n\n" +
              "## الفرص اللي مستغلهاش حد\n" +
              "الفجوات اللي لقيتها، وليه دي فرصة لمشروع العميل بالذات مش لأي حد.\n\n" +
              "## خطة 30 يوم\n" +
              "من 6 لـ 8 خطوات مرتبة بالأولوية. كل خطوة: إيه تعمل بالظبط، وليه، وإزاي تعرف إنها نجحت. مش نصايح عامة.\n\n" +
              "## المصادر\n" +
              "لينكات اللي اتبنى عليه التقرير.\n\n" +
              "قواعد: متألّفش أي رقم مش موجود في نتايج البحث. أي معلومة ناقصة اكتب جنبها «مش متاح» وكمّل - " +
              "التقرير الناقص الصادق أحسن من الكامل المتألف. اكتب التقرير بس من غير مقدمات ولا خاتمة عن نفسك.",
            prompt:
              "بيانات المشروع:\n{{2.text}}\n\n" +
              "نتايج البحث عن المنافسين:\n{{3.text}}\n\n" +
              "اكتب التقرير كامل.",
            maxTokens: 30000,
          },
        },
        {
          id: "5",
          type: "report.document",
          name: "التقرير",
          position: at(4),
          params: {
            title: "تحليل المنافسين - {{2.business}}",
            subtitle: "{{2.market}}",
            content: "{{4.text}}",
            highlights: "عدد المنافسين: {{2.count}}\nالسوق: {{2.market}}\nالتاريخ: {{$today}}",
            footer: "تقرير آلي من تدفّق - اتعمل من بحث حقيقي في النت",
            fileName: "تحليل المنافسين",
          },
        },
        {
          id: "6",
          type: "wasender.send",
          name: "الملف يوصلك على واتساب",
          position: at(5),
          params: {
            to: "",
            messageType: "document",
            mediaUrl: "{{5.wordUrl}}",
            fileName: "تحليل المنافسين.docx",
            text:
              "📊 تقرير المنافسين بتاع {{2.business}} جاهز\n\n" +
              "الملف مرفق - تفتحه في Word أو Google Docs وتحفظه PDF.\n" +
              "وتقدر تفتحه كصفحة من هنا: {{5.url}}",
          },
        },
      ],
      edges: chain("1", "2", "3", "4", "5", "6"),
    },
  },

  /* ------------------------------------------------------------------ *
   * The jobs themselves.
   * ------------------------------------------------------------------ */
  {
    id: "daily-business-report",
    name: "موظف التقارير: تقرير يومي عن شغلك يوصلك آخر اليوم",
    description:
      "كل يوم بالليل بيقرا شيت الطلبات (أو أي شيت بتسجّل فيه)، ويكتب لك تقرير: عملت كام، إيه اللي زاد وإيه اللي قلّ، وإيه اللي محتاج انتباهك بكرة - ويبعتهولك على واتساب",
    category: "شغل يومي",
    requires: [AI, SHEET("التاريخ، العميل، المنتج، المبلغ، الحالة"), WHATSAPP],
    graph: {
      nodes: [
        {
          id: "1",
          type: "trigger.schedule",
          name: "كل يوم بالليل",
          position: at(0),
          params: { mode: "daily", time: "21:00", timezone: "Africa/Cairo" },
        },
        { id: "2", type: "sheets.read", name: "اقرا الشيت", position: at(1), params: { spreadsheetId: "", sheet: "Sheet1", limit: 500 } },
        {
          id: "3",
          type: "ai.generate",
          name: "اكتب التقرير",
          position: at(2),
          params: {
            system:
              "أنت محاسب ومحلل بيكتب لصاحب مشروع صغير بالعامية المصرية. اكتب بـ Markdown:\n\n" +
              "## النهاردة في سطرين\n" +
              "## الأرقام\n" +
              "جدول: البند | النهاردة | الأسبوع ده\n" +
              "## إيه اللي لفت نظري\n" +
              "نقط قصيرة: أكتر منتج اتباع، أكتر عميل اشترى، أي حاجة غريبة أو طلبات واقفة.\n" +
              "## اعمل إيه بكرة\n" +
              "من 3 لـ 5 خطوات عملية.\n\n" +
              "قواعد: احسب من البيانات اللي قدامك بس ومتألّفش. لو عمود ناقص قول إنه ناقص. الفلوس بالجنيه.",
            prompt: "تاريخ النهاردة: {{$today}}\n\nصفوف الشيت:\n{{2.rows}}",
            maxTokens: 6000,
          },
        },
        {
          id: "4",
          type: "report.document",
          name: "التقرير",
          position: at(3),
          params: {
            title: "تقرير يوم {{$today}}",
            subtitle: "ملخص شغل النهاردة",
            content: "{{3.text}}",
            highlights: "عدد الصفوف: {{2.count}}\nالتاريخ: {{$today}}",
            fileName: "تقرير يومي",
          },
        },
        {
          id: "5",
          type: "wasender.send",
          name: "يوصلك على واتساب",
          position: at(4),
          params: {
            to: "",
            messageType: "document",
            mediaUrl: "{{4.wordUrl}}",
            fileName: "تقرير يومي.docx",
            text: "📈 تقرير النهاردة جاهز - الملف مرفق، وتقدر تفتحه كصفحة من هنا: {{4.url}}",
          },
        },
      ],
      edges: chain("1", "2", "3", "4", "5"),
    },
  },
  {
    id: "lead-followup-agent",
    name: "موظف المبيعات: يستقبل العميل، يقيّمه، يرد عليه، ويسجّله",
    description:
      "أي حد يملا فورم طلب السعر: الذكاء الاصطناعي يقيّمه (جاد ولا لأ وليه)، يرد عليه على واتساب برد مكتوب مخصوص ليه، يسجّله في الشيت، ويبعتلك إشعار بالعملاء الجادين بس",
    category: "شغل يومي",
    requires: [AI, SHEET("التاريخ، الاسم، التليفون، الطلب، التقييم، السبب"), WHATSAPP],
    graph: {
      nodes: [
        {
          id: "1",
          type: "trigger.form",
          name: "فورم طلب السعر",
          position: at(0),
          params: {
            title: "اطلب سعر",
            description: "املا بياناتك وهنرد عليك على واتساب",
            formFields: [
              { key: "name", value: "الاسم" },
              { key: "phone", value: "رقم الواتساب" },
              { key: "request", value: "محتاج إيه بالظبط" },
              { key: "budget", value: "الميزانية تقريباً" },
            ],
            submitLabel: "ابعت",
            successMessage: "وصلنا طلبك ✓ هنرد عليك على واتساب خلال شوية",
          },
        },
        {
          id: "2",
          type: "core.brief",
          name: "بيانات مشروعك",
          position: at(1),
          params: { business: "", offer: "", audience: "", market: "مصر", goal: "أرد على العملاء المحتملين بسرعة وأعرف مين فيهم جاد" },
        },
        {
          id: "3",
          type: "ai.generate",
          name: "تقييم والرد",
          position: at(2),
          params: {
            parseJson: true,
            system:
              "أنت موظف مبيعات شاطر وبتكتب بالعامية المصرية. هيجيلك بيانات مشروع وطلب عميل جديد.\n" +
              "قيّم العميل: hot (طلبه واضح وميزانيته مناسبة)، warm (مهتم بس ناقص تفاصيل)، cold (مش مناسب أو مش جاد).\n" +
              'رد بـ JSON بس بالشكل ده: {"score":"hot|warm|cold","reason":"سبب قصير","reply":"الرسالة اللي هتتبعت للعميل على واتساب"}\n' +
              "الرسالة: رحّب باسمه، رد على طلبه بالظبط من بيانات المشروع، اديله خطوة واحدة واضحة بعدها. من 3 لـ 5 سطور، من غير مبالغة ومن غير وعود مش موجودة في بيانات المشروع.",
            prompt: "مشروعي:\n{{2.text}}\n\nالعميل الجديد:\nالاسم: {{1.data.name}}\nالتليفون: {{1.data.phone}}\nمحتاج: {{1.data.request}}\nالميزانية: {{1.data.budget}}",
            maxTokens: 2000,
          },
        },
        {
          id: "4",
          type: "wasender.send",
          name: "رد للعميل",
          position: at(3),
          params: { to: "{{1.data.phone}}", messageType: "text", text: "{{3.json.reply}}" },
        },
        {
          id: "5",
          type: "sheets.append",
          name: "سجّله في الشيت",
          position: at(4),
          params: { spreadsheetId: "", sheet: "Sheet1", mode: "auto", record: "{{1.data}}" },
          continueOnFail: true,
        },
        {
          id: "6",
          type: "logic.if",
          name: "عميل جاد؟",
          position: at(5),
          params: { combine: "all", conditions: [{ left: "{{3.json.score}}", op: "equals", right: "hot" }] },
        },
        {
          id: "7",
          type: "wasender.send",
          name: "نبّهني أنا",
          position: at(6, -110),
          params: {
            to: "",
            messageType: "text",
            text: "🔥 عميل جاد\n\nالاسم: {{1.data.name}}\nالتليفون: {{1.data.phone}}\nمحتاج: {{1.data.request}}\nالميزانية: {{1.data.budget}}\n\nليه جاد: {{3.json.reason}}",
          },
        },
      ],
      edges: [...chain("1", "2", "3", "4", "5", "6"), edge("6", "7", "true")],
    },
  },
  {
    id: "booking-agent",
    name: "موظف الحجوزات: يحجز الميعاد في تقويمك ويأكّد للعميل",
    description:
      "العميل يملا فورم الحجز: الميعاد بيتحط في Google Calendar بتاعك على طول، العميل بيوصله تأكيد على واتساب، والحجز بيتسجّل في شيت - من غير ما حد يرد على تليفون",
    category: "شغل يومي",
    requires: ["Google (Service Account) وتقويم مشارك معاه بصلاحية تعديل", WHATSAPP, SHEET("التاريخ، الاسم، التليفون، الخدمة، الميعاد")],
    graph: {
      nodes: [
        {
          id: "1",
          type: "trigger.form",
          name: "فورم الحجز",
          position: at(0),
          params: {
            title: "احجز ميعادك",
            description: "اختار اليوم والساعة وهنأكدلك على واتساب",
            formFields: [
              { key: "name", value: "الاسم" },
              { key: "phone", value: "رقم الواتساب" },
              { key: "service", value: "الخدمة المطلوبة" },
              { key: "datetime", value: "الميعاد اللي يناسبك (مثال: 2026-10-01 15:00)" },
            ],
            submitLabel: "احجز",
            successMessage: "تم الحجز ✓ هيوصلك تأكيد على واتساب",
          },
        },
        {
          id: "2",
          type: "calendar.createEvent",
          name: "حط الميعاد في التقويم",
          position: at(1),
          params: {
            calendarId: "",
            title: "{{1.data.service}} - {{1.data.name}}",
            start: "{{1.data.datetime}}",
            durationMinutes: 45,
            timezone: "Africa/Cairo",
            description: "تليفون العميل: {{1.data.phone}}",
          },
        },
        {
          id: "3",
          type: "wasender.send",
          name: "تأكيد للعميل",
          position: at(2),
          params: {
            to: "{{1.data.phone}}",
            messageType: "text",
            text: "أهلاً {{1.data.name}} 👋\n\nحجزك اتأكد ✓\nالخدمة: {{1.data.service}}\nالميعاد: {{1.data.datetime}}\n\nلو حصل ظرف ومش هتقدر تيجي، رد على الرسالة دي وهنعدّله",
          },
        },
        {
          id: "4",
          type: "sheets.append",
          name: "سجّل الحجز",
          position: at(3),
          params: { spreadsheetId: "", sheet: "Sheet1", mode: "auto", record: "{{1.data}}" },
          continueOnFail: true,
        },
        {
          id: "5",
          type: "wasender.send",
          name: "نبّهني أنا",
          position: at(4),
          params: { to: "", messageType: "text", text: "📅 حجز جديد\n{{1.data.name}} · {{1.data.phone}}\n{{1.data.service}} · {{1.data.datetime}}" },
        },
      ],
      edges: chain("1", "2", "3", "4", "5"),
    },
  },
  {
    id: "expense-logger",
    name: "موظف الحسابات: ابعت المصروف كلام على واتساب وهو يسجّله",
    description:
      "ابعت لبوت تيليجرام «دفعت 450 للمورد بضاعة» أو «قبضت 1200 من عميل»، والذكاء الاصطناعي يفهم المبلغ والنوع والبند ويسجّلهم في الشيت لوحده، ويرد عليك بالتأكيد - بدل دفتر الحسابات",
    category: "شغل يومي",
    requires: [AI, "بوت تيليجرام (من @BotFather)", SHEET("التاريخ، النوع، المبلغ، البند، ملاحظات")],
    graph: {
      nodes: [
        { id: "1", type: "telegram.trigger", name: "رسالة منك", position: at(0), params: { updateType: "message" } },
        {
          id: "2",
          type: "ai.generate",
          name: "افهم المصروف",
          position: at(1),
          params: {
            parseJson: true,
            system:
              "أنت محاسب. هتيجيلك جملة بالعامية عن فلوس اتدفعت أو اتقبضت.\n" +
              'رد بـ JSON بس: {"النوع":"مصروف|إيراد","المبلغ":رقم من غير عملة,"البند":"كلمتين","ملاحظات":"باقي التفاصيل","التاريخ":"YYYY-MM-DD"}\n' +
              "لو الجملة مفهاش فلوس خالص، رد بـ {\"النوع\":\"\",\"المبلغ\":0,\"البند\":\"\",\"ملاحظات\":\"مش فاهم\",\"التاريخ\":\"\"}\n" +
              "لو التاريخ مش مذكور استخدم تاريخ النهاردة.",
            prompt: "تاريخ النهاردة: {{$today}}\n\nالرسالة: {{1.message.text}}",
            maxTokens: 800,
          },
        },
        {
          id: "3",
          type: "sheets.append",
          name: "سجّل في الشيت",
          position: at(2),
          params: { spreadsheetId: "", sheet: "Sheet1", mode: "auto", record: "{{2.json}}" },
        },
        {
          id: "4",
          type: "telegram.sendMessage",
          name: "أكّدلي",
          position: at(3),
          params: {
            chatId: "{{1.message.chat.id}}",
            text: "✓ اتسجّل\n{{2.json.النوع}}: {{2.json.المبلغ}} جنيه\nالبند: {{2.json.البند}}",
            replyToMessageId: "{{1.message.message_id}}",
          },
        },
      ],
      edges: chain("1", "2", "3", "4"),
    },
  },
  {
    id: "cv-screening",
    name: "موظف التوظيف: يفرز المتقدمين ويرشّحلك الأحسن",
    description:
      "اكتب المواصفات اللي عايزها مرة واحدة، وأي حد يقدّم على الفورم الذكاء الاصطناعي يقراه ويديله درجة من 10 بسبب واضح، يسجّله في الشيت، ويبعتلك إشعار باللي فوق 7 بس",
    category: "شغل يومي",
    requires: [AI, SHEET("التاريخ، الاسم، التليفون، الدرجة، السبب"), "بوت تيليجرام أو واتساب عشان الترشيحات توصلك"],
    graph: {
      nodes: [
        {
          id: "1",
          type: "trigger.form",
          name: "فورم التقديم",
          position: at(0),
          params: {
            title: "قدّم معانا",
            description: "املا بياناتك وهنرد على المناسبين",
            formFields: [
              { key: "name", value: "الاسم" },
              { key: "phone", value: "رقم الواتساب" },
              { key: "experience", value: "خبرتك في المجال" },
              { key: "why", value: "ليه عايز تشتغل معانا" },
              { key: "cv", value: "رابط الـ CV (Google Drive أو LinkedIn)" },
            ],
            submitLabel: "قدّم",
            successMessage: "وصلنا طلبك ✓ هنكلمك لو كنت مناسب",
          },
        },
        {
          id: "2",
          type: "ai.generate",
          name: "الفرز",
          position: at(1),
          params: {
            parseJson: true,
            system:
              "أنت مسؤول توظيف. هتيجيلك مواصفات الوظيفة وبيانات متقدم.\n" +
              'رد بـ JSON بس: {"الدرجة":رقم من 1 لـ 10,"السبب":"جملتين","نقط القوة":"...","اللي ناقصه":"..."}\n' +
              "قيّم من اللي مكتوب قدامك بس. المتقدم اللي بياناته ناقصة أو عامة خد درجة أقل. متتحيزش لأي حاجة مالهاش علاقة بالشغل.",
            prompt:
              "الوظيفة والمواصفات اللي بدوّر عليها:\n(اكتب هنا الوظيفة والمواصفات المطلوبة - مثلاً: مندوب مبيعات، خبرة سنتين في المبيعات الميدانية، عنده موتوسيكل، ساكن في القاهرة)\n\n" +
              "المتقدم:\nالاسم: {{1.data.name}}\nالخبرة: {{1.data.experience}}\nليه عايز يشتغل: {{1.data.why}}\nالـ CV: {{1.data.cv}}",
            maxTokens: 1500,
          },
        },
        {
          id: "3",
          type: "sheets.append",
          name: "سجّله",
          position: at(2),
          params: { spreadsheetId: "", sheet: "Sheet1", mode: "auto", record: "{{1.data}}" },
          continueOnFail: true,
        },
        {
          id: "4",
          type: "logic.if",
          name: "مناسب؟",
          position: at(3),
          params: { combine: "all", conditions: [{ left: "{{2.json.الدرجة}}", op: "gte", right: "7" }] },
        },
        {
          id: "5",
          type: "telegram.sendMessage",
          name: "رشّحهولي",
          position: at(4, -110),
          params: {
            chatId: "",
            text:
              "👤 متقدم كويس ({{2.json.الدرجة}}/10)\n\n{{1.data.name}} · {{1.data.phone}}\nالـ CV: {{1.data.cv}}\n\nليه: {{2.json.السبب}}\nقوته: {{2.json.نقط القوة}}\nناقصه: {{2.json.اللي ناقصه}}",
          },
        },
      ],
      edges: [...chain("1", "2", "3", "4"), edge("4", "5", "true")],
    },
  },
];
