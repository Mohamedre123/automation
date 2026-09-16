import { Link } from "react-router-dom";
import { useReveal } from "../../components/PublicLayout";
import { useAuth } from "../../context";
import { Icon } from "../../icons";

const GROUPS = [
  {
    title: "بناء الأتمتة",
    items: [
      { icon: "flows", title: "محرر مرئي بالسحب والإفلات", text: "اربط الخطوات على لوحة واحدة، وفرّع المسار بشروط، وشغّل كذا فرع مع بعض." },
      { icon: "braces", title: "ربط البيانات بين الخطوات", text: "اختار أي معلومة من خطوة سابقة بضغطة من قايمة، من غير ما تكتب أي كود." },
      { icon: "play", title: "تجربة فورية", text: "زرار «تشغيل مرة» بيوريك نتيجة كل خطوة بمدخلاتها ومخرجاتها قبل ما تفعّل." },
      { icon: "templates", title: "تيمبلت جاهزة", text: "ابدأ من سيناريو شغال وعدّل عليه، أو ابدأ من الصفر لأي فكرة عندك." },
    ],
  },
  {
    title: "الذكاء الاصطناعي",
    items: [
      { icon: "bot", title: "AI Agent بأدوات وذاكرة", text: "بيرد على العملاء، يفتكر كل محادثة، يحفظ الطلبات، ويستدعي أي API." },
      { icon: "sparkles", title: "أي مزوّد تحبه", text: "Gemini أو ChatGPT أو Claude - كل عميل بيحط مفتاحه ويختار الموديل." },
      { icon: "instagram", title: "توليد صور", text: "صور إعلانية ومنتجات بالذكاء الاصطناعي، جاهزة للنشر مباشرة." },
      { icon: "send", title: "تحويل للعميل لموظف", text: "الـ Agent يعرف إمتى يحوّل المحادثة ليك ويبعتلك بيانات العميل فوراً." },
    ],
  },
  {
    title: "القنوات والتطبيقات",
    items: [
      { icon: "whatsapp", title: "واتساب", text: "عن طريق WasenderAPI (الأرخص) أو واتساب الرسمي من Meta." },
      { icon: "send", title: "تيليجرام", text: "بوتات تستقبل الرسايل وترد وتبعت صور وإشعارات." },
      { icon: "instagram", title: "فيسبوك وإنستجرام", text: "نشر بوستات وصور على صفحتك وحسابك البيزنس." },
      { icon: "globe", title: "أي API", text: "خطوة HTTP بتكلم أي خدمة في الدنيا بمفتاح العميل." },
    ],
  },
  {
    title: "تشغيل موثوق",
    items: [
      { icon: "clock", title: "جدولة", text: "كل دقيقة، كل ساعة، أو مواعيد Cron مخصصة بتوقيت القاهرة." },
      { icon: "webhook", title: "Webhooks", text: "استقبل بيانات من أي موقع أو فورم، ورجّع رد مخصص كأنه API." },
      { icon: "history", title: "سجل تشغيل كامل", text: "كل تشغيل متسجل خطوة خطوة، ولو فيه خطأ هتعرف مكانه بالظبط." },
      { icon: "key", title: "أمان المفاتيح", text: "كل مفاتيح الـ API بتتشفّر AES-256 ومش بتظهر تاني لحد." },
    ],
  },
];

export function Features() {
  const { user } = useAuth();
  useReveal();
  return (
    <div className="section">
      <div className="section-head reveal" style={{ marginTop: 10 }}>
        <span className="eyebrow">
          <Icon name="sparkles" size={15} /> المميزات
        </span>
        <h2>كل اللي تحتاجه عشان تأتمت شغلك</h2>
        <p>من أول بوت خدمة عملاء بسيط لحد سيناريوهات معقدة بتربط كذا تطبيق.</p>
      </div>

      {GROUPS.map((group) => (
        <div key={group.title} className="feature-group">
          <h3 className="group-title reveal">{group.title}</h3>
          <div className="feature-grid">
            {group.items.map((item, i) => (
              <article className="feature reveal" key={item.title} style={{ transitionDelay: `${i * 50}ms` }}>
                <div className="f-icon">
                  <Icon name={item.icon} size={22} />
                </div>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </div>
      ))}

      <div className="cta reveal" style={{ marginTop: 50 }}>
        <h2>جرّبها بنفسك</h2>
        <p>مجاناً ومن غير بطاقة ائتمان.</p>
        <Link className="btn primary lg" to={user ? "/app" : "/register"}>
          {user ? "افتح لوحة التحكم" : "إنشاء حساب مجاني"}
        </Link>
      </div>
    </div>
  );
}
