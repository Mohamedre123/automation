# تدفّق (Tadfuq) - منصة أتمتة سيناريوهات العمل

منصة أتمتة مرئية على طريقة Make وn8n، مكتوبة من الصفر بالكامل: محرر سيناريوهات بالسحب والإفلات، محرك تنفيذ، Webhooks، جدولة، حسابات متشفّرة، سجل تشغيل، وتيمبلت جاهزة.

## التشغيل

محتاج Node.js 24 أو أحدث.

```bash
npm install
npm run dev
```

- الواجهة: http://localhost:5173
- الـ API والـ Webhooks: http://localhost:3000

أول مرة اعمل حساب من صفحة التسجيل.

### الإنتاج (Production)

```bash
npm run build
npm start
```

السيرفر بيقدّم الواجهة والـ API على نفس البورت. انسخ `.env.example` لـ `.env` وحط:
- `PUBLIC_URL` = الدومين بتاعك (عشان روابط الـ Webhooks تطلع صح)
- `APP_SECRET` = نص عشوائي طويل (بيشفّر مفاتيح العملاء - متغيّرهوش بعد التشغيل)
- `HOST=0.0.0.0`

## هيكل المشروع

```
server/src/
  engine/        محرك التنفيذ: executor (تشغيل الخطوات)، expressions ({{1.message.text}})، queue
  nodes/         التكاملات: core (webhook, schedule, if, set, delay, respond, datastore)، http، telegram، anthropic
  triggers/      تشغيل المحفّزات في الخلفية (webhook / schedule / polling) + «تشغيل مرة»
  routes/        الـ API
  templates.ts   التيمبلت الجاهزة
web/src/
  editor/        محرر السيناريو (React Flow): الخطوات، لوحة الإعدادات، منتقي المتغيرات
  pages/         لوحة التحكم، التيمبلت، الحسابات، سجل التشغيلات، مخزن البيانات
```

## إضافة تكامل جديد

1. اعمل ملف في `server/src/nodes/` يصدّر `NodeDefinition[]` (وكمان `CredentialType` لو التطبيق محتاج مفتاح).
2. سجّله في `server/src/nodes/index.ts`.
3. خلاص - الواجهة بتبني فورم الإعدادات لوحدها من تعريف الحقول (`fields`).

كل خطوة بتحدد: الحقول، نوع الحساب، مثال للمخرجات (`sampleOutput` عشان منتقي المتغيرات)، ودالة `run` (أو `poll` للمحفّزات).

## الربط بين الخطوات

أي حقل يقبل متغيرات بالشكل ده:
- `{{1.message.text}}` مخرجات الخطوة رقم 1
- `{{2.items[0].name}}` عنصر من مصفوفة
- `{{1.body["full name"]}}` مفتاح فيه مسافات
- `{{$now}}` و`{{$today}}` و`{{$execution.id}}` متغيرات النظام

## الخطوات الجاية المقترحة

- تكاملات: WhatsApp Business، Gmail/Google Sheets (OAuth)، OpenAI، Slack، Paymob، Shopify/Salla
- Iterator / Aggregator للتعامل مع القوائم
- خطوة كود (JavaScript في sandbox)
- فرق ومستخدمين وصلاحيات + اشتراكات وحدود استخدام
- Redis/BullMQ عشان يشتغل على أكتر من سيرفر
- Rate limiting وحماية SSRF لخطوة HTTP قبل ما تفتحها لعملاء خارجيين
