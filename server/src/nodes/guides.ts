/**
 * Step-by-step "how do I get this key" guides shown when a customer connects an account.
 * Written for non-developers: every click, in order, and what to paste where.
 */
export const credentialGuides: Record<string, string[]> = {
  /* ---------- الذكاء الاصطناعي ---------- */
  geminiApi: [
    "افتح aistudio.google.com وسجّل دخول بحساب جوجل",
    "من القائمة اضغط «Get API key» ثم «Create API key»",
    "اختار مشروع (أو اعمل مشروع جديد) واضغط Create",
    "انسخ المفتاح (بيبدأ بـ AIza) والصقه في خانة API Key هنا",
    "فيه باقة مجانية للنصوص. توليد الصور والفيديو (Veo) محتاجين تفعّل الفوترة (Billing) على نفس المشروع",
  ],
  openaiApi: [
    "افتح platform.openai.com وسجّل دخول",
    "من Settings ← Billing اشحن رصيد (لازم رصيد عشان المفتاح يشتغل)",
    "روح API keys ← Create new secret key، سمّيه «تدفق» واضغط Create",
    "انسخ المفتاح (بيبدأ بـ sk-) فوراً لأنه مش هيظهر تاني، والصقه هنا",
  ],
  anthropicApi: [
    "افتح console.anthropic.com وسجّل دخول",
    "من Plans & Billing اشحن رصيد",
    "روح API Keys ← Create Key، سمّيه «تدفق»",
    "انسخ المفتاح (بيبدأ بـ sk-ant-) والصقه هنا",
  ],

  customAiApi: [
    "ينفع مع أي مزوّد متوافق مع OpenAI API. أمثلة للرابط (Base URL):",
    "DeepSeek: https://api.deepseek.com/v1 - Groq: https://api.groq.com/openai/v1 - OpenRouter: https://openrouter.ai/api/v1",
    "Mistral: https://api.mistral.ai/v1 - xAI (Grok): https://api.x.ai/v1 - Qwen: https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    "سيرفرك الخاص: Ollama على http://your-server:11434/v1 أو LM Studio (لازم يكون على رابط عام)",
    "من لوحة المزوّد روح API Keys واعمل مفتاح جديد والصقه هنا",
    "اكتب اسم الموديل الافتراضي زي ما المزوّد كاتبه (مثلاً deepseek-chat أو llama-3.3-70b-versatile)",
    "اضغط «اختبار الاتصال»، وبعد الحفظ هتلاقيه في كل خطوات الذكاء الاصطناعي جنب Gemini وChatGPT وClaude",
  ],

  /* ---------- واتساب وتيليجرام ---------- */
  telegramBot: [
    "افتح تيليجرام وابحث عن @BotFather (عليه علامة التوثيق الزرقا)",
    "ابعتله /newbot، واكتب اسم البوت، وبعدين يوزرنيم لازم يخلص بـ bot (مثلاً mystore_bot)",
    "هيبعتلك رسالة فيها التوكن بالشكل 123456789:ABC... - انسخه والصقه في خانة Bot Token",
    "اضغط «اختبار الاتصال» للتأكد، وبعدين «حفظ»",
    "مهم للتحويل لموظف: المسؤول لازم يفتح البوت ويبعتله أي رسالة (/start) مرة واحدة عشان البوت يقدر يكلمه",
    "للنشر في قناة: ضيف البوت كأدمن في القناة، واكتب يوزرنيم القناة (@my_channel)",
  ],
  wasenderApi: [
    "اعمل حساب على wasenderapi.com واشترك في باقة",
    "من لوحة التحكم ← WhatsApp Sessions ← Create Session، واكتب رقمك",
    "اضغط Connect وامسح الـ QR Code من واتساب على موبايلك (الإعدادات ← الأجهزة المرتبطة ← ربط جهاز)",
    "بعد ما الحالة تبقى Connected افتح الجلسة وانسخ «API Key» والصقه هنا",
    "لو هتستقبل رسايل: في صفحة الجلسة فعّل Webhook، والرابط هتلاقيه في خطوة «رسالة واتساب جديدة» جوه السيناريو. انسخ Webhook Secret من هناك والصقه هنا (اختياري بس أأمن)",
  ],
  whatsappCloud: [
    "افتح developers.facebook.com ← My Apps ← Create App ← اختار Business",
    "من صفحة التطبيق ضيف منتج WhatsApp ← Set up",
    "من WhatsApp ← API Setup انسخ «Phone number ID» والصقه هنا",
    "التوكن المؤقت بيخلص بعد 24 ساعة: اعمل توكن دائم من business.facebook.com ← Settings ← System users ← Add ← Generate token بصلاحيات whatsapp_business_messaging و whatsapp_business_management",
    "اكتب أي كلمة سر من اختيارك في Verify Token (هتكتبها نفسها عند Meta)",
    "لاستقبال الرسايل: WhatsApp ← Configuration ← Webhook ← Edit: حط رابط الـ Webhook من خطوة «رسالة واتساب جديدة (الرسمي)» ونفس Verify Token، واشترك في messages",
  ],

  /* ---------- السوشيال ميديا ---------- */
  facebookPage: [
    "افتح developers.facebook.com ← My Apps ← Create App ← Business",
    "افتح Tools ← Graph API Explorer واختار التطبيق بتاعك",
    "من Permissions ضيف pages_manage_posts و pages_read_engagement و pages_show_list، واضغط Generate Access Token ووافق",
    "من «User or Page» اختار صفحتك - هيطلعلك Page Access Token",
    "عشان التوكن ميخلصش: افتحه في Access Token Debugger (developers.facebook.com/tools/debug/accesstoken) واضغط «Extend Access Token»",
    "رقم الصفحة (Page ID): من صفحتك ← About ← Page transparency، أو من Graph API Explorer بطلب me?fields=id",
  ],
  instagramBusiness: [
    "حوّل حساب إنستجرام لـ Business أو Creator (إنستجرام ← الإعدادات ← نوع الحساب). الحساب الشخصي مش بينشر بالـ API خالص",
    "اربطه بصفحة فيسبوك: إعدادات الصفحة ← Linked accounts ← Instagram ← Connect account",
    "افتح developers.facebook.com ← My Apps ← Create App ← Business، وضيف منتج «Instagram» أو «Instagram Graph API»",
    "افتح Tools ← Graph API Explorer، اختار التطبيق، وضيف الصلاحيات: instagram_basic و instagram_content_publish و pages_show_list و pages_read_engagement",
    "دوس Generate Access Token ووافق على الصفحة والحساب، وانسخ التوكن",
    "مهم: التوكن ده بيخلص بعد ساعة. افتح developers.facebook.com/tools/debug/accesstoken، الصقه، ودوس «Extend Access Token» عشان يبقى شهرين",
    "الصق التوكن هنا، وسيب خانة «Instagram User ID» فاضية ودوس «اختبار الاتصال» - إحنا بنجيب الرقم الصح من التوكن ونحفظه. (ولو كتبت رقم صفحة الفيسبوك بالغلط برضو بنوصل للحساب منه.)",
    "أشهر سبب لرسالة «التوكن مرفوض» إنك ناسخ التوكن المؤقت من غير ما تمدّده - رجّع الخطوة اللي فوق",
    "أشهر سبب لرسالة «الرقم مش شايفه» إنك حاطط رقم من رابط البروفايل أو رقم التطبيق - سيب الخانة فاضية وسيبنا نجيبه",
    "ملحوظة: إنستجرام بينشر صورة أو فيديو بس (مش نص لوحده)، والملف لازم يكون على رابط عام - صور وفيديوهات المنصة جاهزة لكده. الكاروسيل من صورتين لـ 10",
  ],
  threadsApi: [
    "من developers.facebook.com اعمل App واختار «Access the Threads API»",
    "من Use cases ← Threads API فعّل threads_basic و threads_content_publish",
    "من App roles ضيف حساب Threads بتاعك كـ Threads Tester ووافق من إعدادات Threads ← Website permissions",
    "من Graph API Explorer (threads.net) اعمل Access token، واطلب me?fields=id,username عشان تجيب Threads user ID",
    "الصق الـ user ID والتوكن هنا",
  ],
  linkedinApi: [
    "افتح linkedin.com/developers/apps ← Create app، واربطه بصفحة الشركة بتاعتك",
    "من تبويب Products فعّل «Share on LinkedIn» و «Sign In with LinkedIn using OpenID Connect»",
    "افتح linkedin.com/developers/tools/oauth/token-generator، اختار التطبيق وعلّم openid و profile و w_member_social، واضغط Request access token",
    "انسخ التوكن والصقه هنا (صالح 60 يوم - بعدها اعمل واحد جديد بنفس الطريقة)",
    "للنشر باسم صفحة شركة: محتاج صلاحية w_organization_social، واكتب Author URN بالشكل urn:li:organization:رقم_الصفحة",
  ],
  xOAuth1: [
    "افتح developer.x.com واعمل حساب مطوّر (الباقة المجانية بتسمح بالنشر)",
    "من Projects & Apps افتح التطبيق ← User authentication settings ← Set up: اختار Read and write واكتب أي Website وCallback (مثلاً رابط موقعك)",
    "روح Keys and tokens: من Consumer Keys اضغط Regenerate وانسخ API Key و API Key Secret",
    "من Authentication Tokens اضغط Generate لـ Access Token and Secret (لازم يكون مكتوب Read and Write)",
    "الصق الأربع قيم هنا",
  ],
  pinterestApi: [
    "حوّل حسابك لـ Business من إعدادات Pinterest",
    "افتح developers.pinterest.com ← My apps ← Connect app واطلب Trial access",
    "من صفحة التطبيق اعمل Access token بصلاحيات boards:read و pins:read و pins:write",
    "الصق التوكن هنا",
    "رقم اللوحة (Board ID): افتح اللوحة، أو جرّب خطوة HTTP على api.pinterest.com/v5/boards",
  ],
  blueskyApi: [
    "افتح bsky.app ← Settings ← Privacy and security ← App passwords",
    "اضغط Add App Password واكتب «تدفق» وانسخ الباسورد",
    "اكتب يوزرنيمك (مثلاً name.bsky.social) والباسورد هنا. متستخدمش باسورد حسابك الأساسي",
  ],

  /* ---------- المواقع والمتاجر ---------- */
  wordpressApi: [
    "ادخل لوحة ووردبريس بحساب Administrator أو Editor",
    "روح Users ← Profile (الملف الشخصي) وانزل لآخر الصفحة لقسم Application Passwords",
    "اكتب اسم (مثلاً تدفق) واضغط Add New Application Password",
    "انسخ الباسورد اللي ظهر (24 حرف بمسافات) والصقه هنا - ده مش باسورد الدخول",
    "اكتب رابط موقعك (https://...) واسم المستخدم بتاعك",
    "لو القسم مش ظاهر: الموقع لازم يكون HTTPS، أو فيه إضافة حماية قافلة REST API",
  ],
  ghostAdmin: [
    "ادخل Ghost Admin ← Settings ← Integrations ← Add custom integration",
    "سمّيها «تدفق» واضغط Create",
    "انسخ Admin API key و API URL والصقهم هنا",
  ],
  webflowApi: [
    "افتح Webflow ← Site settings ← Apps & integrations",
    "في API access اضغط Generate API token، واختار CMS: Read and write و Sites: Read",
    "انسخ التوكن والصقه هنا",
    "Collection ID: من CMS ← الـ Collection ← Settings",
  ],
  shopifyAdmin: [
    "من لوحة Shopify روح Settings ← Apps and sales channels ← Develop apps",
    "اضغط Allow custom app development (أول مرة بس) وبعدين Create an app",
    "Configure Admin API scopes: علّم read_orders و read_products و read_customers واحفظ",
    "من API credentials اضغط Install app وبعدين Reveal token once وانسخ التوكن (بيبدأ بـ shpat_)",
    "اكتب اسم المتجر (الجزء اللي قبل .myshopify.com) والتوكن هنا",
  ],
  wooCommerce: [
    "من لوحة ووردبريس روح WooCommerce ← Settings ← Advanced ← REST API",
    "اضغط Add key، اختار المستخدم واختار Permissions: Read/Write",
    "اضغط Generate API key وانسخ Consumer key و Consumer secret والصقهم هنا",
    "اكتب رابط موقعك (لازم HTTPS)",
  ],
  sallaApi: [
    "اعمل حساب على salla.partners (بوابة شركاء سلة)",
    "من My Apps ← Create App اختار «تطبيق خاص» (Private app) واربطه بمتجرك",
    "من إعدادات التطبيق فعّل صلاحيات الطلبات والمنتجات (orders.read_write و products.read_write)",
    "ثبّت التطبيق على متجرك التجريبي أو الحقيقي، وانسخ Access Token من صفحة التطبيق والصقه هنا",
  ],
  zidApi: [
    "اعمل حساب على partner.zid.sa (بوابة شركاء زد)",
    "اعمل تطبيق جديد وفعّل صلاحيات الطلبات",
    "ثبّت التطبيق على متجرك - هتاخد Authorization token و Access token (X-Manager-Token)",
    "الصق الاتنين هنا",
  ],
  wixApi: [
    "افتح manage.wix.com/account/api-keys ← Generate API Key",
    "علّم صلاحيات Wix Stores و eCommerce واضغط Generate",
    "انسخ المفتاح والصقه هنا",
    "Site ID: افتح لوحة الموقع - هو الرقم الطويل اللي في الرابط بعد /dashboard/",
  ],
  stripeApi: [
    "افتح dashboard.stripe.com ← Developers ← API keys",
    "انسخ Secret key (sk_live_ للحقيقي أو sk_test_ للتجربة) والصقه هنا",
    "الأأمن: اعمل Restricted key بصلاحية Read بس على Charges و Customers",
  ],

  /* ---------- أدوات الشغل ---------- */
  googleServiceAccount: [
    "افتح console.cloud.google.com واعمل مشروع جديد",
    "من APIs & Services ← Library فعّل اللي هتستخدمه: Google Sheets API و Google Drive API و Google Calendar API",
    "روح IAM & Admin ← Service Accounts ← Create service account (سمّيه تدفق) ← Done",
    "افتح الحساب ← Keys ← Add key ← Create new key ← JSON - هينزل ملف",
    "افتح الملف بأي محرر نصوص، وانسخ محتواه كله والصقه هنا",
    "انسخ الإيميل اللي في الملف (client_email) وشارك معاه اللي عايز المنصة توصله: الشيت (Editor)، أو فولدر Drive، أو التقويم (Make changes to events)",
  ],
  resendApi: [
    "اعمل حساب مجاني على resend.com",
    "من Domains ← Add Domain ضيف دومينك، وحط سجلات DNS اللي هيطلبها عند مزوّد الدومين لحد ما يبقى Verified",
    "من API Keys ← Create API Key، انسخه (بيبدأ بـ re_) والصقه هنا",
    "اكتب الإيميل المرسل من نفس الدومين (مثلاً: شركتي <hello@yourdomain.com>)",
  ],
  slackBot: [
    "افتح api.slack.com/apps ← Create New App ← From scratch، واختار الـ Workspace",
    "من OAuth & Permissions ← Bot Token Scopes ضيف chat:write",
    "اضغط Install to Workspace ووافق، وانسخ Bot User OAuth Token (xoxb-...)",
    "في القناة اللي هتبعت فيها اكتب /invite @اسم_التطبيق",
  ],
  discordWebhook: [
    "افتح إعدادات القناة في ديسكورد ← Integrations ← Webhooks",
    "اضغط New Webhook، سمّيه، واضغط Copy Webhook URL",
    "الصق الرابط هنا",
  ],
  airtableToken: [
    "افتح airtable.com/create/tokens ← Create new token",
    "Scopes: ضيف data.records:read و data.records:write و schema.bases:read",
    "Access: اختار القاعدة (Base) اللي هتشتغل عليها ← Create token",
    "انسخ التوكن (بيبدأ بـ pat) والصقه هنا",
  ],
  notionToken: [
    "افتح notion.so/profile/integrations ← New integration، واختار الـ Workspace",
    "انسخ Internal Integration Secret والصقه هنا",
    "افتح الصفحة أو قاعدة البيانات في Notion ← النقط التلاتة ← Connections ← ضيف الـ Integration",
  ],
  trelloApi: [
    "افتح trello.com/power-ups/admin ← New، واملا البيانات",
    "من صفحة الـ Power-Up ← API key ← Generate a new API key، وانسخه في خانة API Key",
    "في نفس الصفحة اضغط لينك «Token» ووافق، وانسخ التوكن في خانة Token",
  ],
  githubToken: [
    "افتح github.com/settings/personal-access-tokens ← Generate new token (Fine-grained)",
    "اختار الريبو، ومن Permissions ← Issues اختار Read and write",
    "اضغط Generate token وانسخه والصقه هنا",
  ],
  hubspotToken: [
    "من HubSpot ← Settings ← Integrations ← Private Apps ← Create a private app",
    "من Scopes علّم crm.objects.contacts.read و crm.objects.contacts.write",
    "اضغط Create app وانسخ Access token (pat-...) والصقه هنا",
  ],
  mailchimpApi: [
    "من Mailchimp اضغط على صورتك ← Profile ← Extras ← API keys",
    "اضغط Create A Key وانسخه (آخره حاجة زي -us21) والصقه هنا",
  ],

  /* ---------- HTTP ---------- */
  httpHeaderAuth: [
    "من توثيق الخدمة اعرف اسم الـ Header اللي بيتبعت فيه المفتاح (مثلاً X-API-Key)",
    "اكتب اسم الـ Header وقيمة المفتاح هنا",
  ],
  httpBearer: ["هات الـ Token من لوحة الخدمة (غالباً API Keys أو Developers)", "الصقه هنا - هيتبعت كـ Authorization: Bearer <token>"],
  httpBasic: ["اكتب اسم المستخدم وكلمة السر اللي الخدمة بتطلبهم", "هيتبعتوا مشفّرين في Authorization: Basic"],
};
