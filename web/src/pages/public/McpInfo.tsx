import { Link } from "react-router-dom";
import { useReveal } from "../../components/PublicLayout";
import { useAuth } from "../../context";
import { Icon } from "../../icons";

const STEPS = [
  { icon: "flows", h: "ابني السيناريو", p: "أي سيناريو بمحفّز Webhook أو فورم أو تشغيل يدوي: تسجيل عميل، إرسال عرض سعر، نشر بوست، تقرير..." },
  { icon: "plug", h: "حطه في Toolbox", p: "من صفحة MCP اختار السيناريوهات اللي عايز الذكاء الاصطناعي يوصلها، وخد رابط سري واحد." },
  { icon: "sparkles", h: "اطلب بالكلام", p: "الصق الرابط في Claude أو ChatGPT أو Cursor، وقول مثلاً «سجّل أحمد في الشيت وابعتله رسالة ترحيب»." },
];

const CLIENTS = ["Claude", "ChatGPT", "Cursor", "VS Code", "Windsurf", "أي برنامج بيدعم MCP"];

export function McpInfo() {
  const { user } = useAuth();
  useReveal();
  return (
    <div className="section">
      <div className="section-head reveal" style={{ marginTop: 10 }}>
        <span className="eyebrow">
          <Icon name="plug" size={15} /> خادم MCP
        </span>
        <h2>خلّي Claude و ChatGPT يشغّلوا سيناريوهاتك</h2>
        <p>
          MCP بروتوكول مفتوح بيخلّي المساعدات الذكية تستخدم أدوات حقيقية. مع تدفّق، كل سيناريو بتبنيه ممكن يبقى أداة يشغّلها المساعد بتاعك وقت ما
          تطلب منه - وانت متحكم في إيه اللي يوصله.
        </p>
      </div>

      <div className="feature-grid">
        {STEPS.map((step, i) => (
          <article key={step.h} className="feature reveal" style={{ transitionDelay: `${i * 60}ms` }}>
            <div className="f-icon">
              <Icon name={step.icon} size={22} />
            </div>
            <h3>
              {i + 1}. {step.h}
            </h3>
            <p>{step.p}</p>
          </article>
        ))}
      </div>

      <div className="card mcp-demo reveal">
        <div className="mcp-demo-chat">
          <div className="bubble user">سجّل العميل ده: منى علي، 01012345678، عايزة عرض سعر للباقة السنوية</div>
          <div className="bubble tool">
            <Icon name="plug" size={14} /> شغّلت «تسجيل عميل + عرض سعر» على تدفّق
          </div>
          <div className="bubble bot">تمام ✓ منى اتسجلت في الشيت، واتبعتلها عرض السعر على واتساب.</div>
        </div>
      </div>

      <div className="section-head reveal" style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 24 }}>شغال مع</h2>
      </div>
      <div className="chips center reveal">
        {CLIENTS.map((c) => (
          <span key={c} className="chip">
            {c}
          </span>
        ))}
      </div>

      <div className="feature-grid" style={{ marginTop: 34 }}>
        {[
          { icon: "shield", h: "انت متحكم", p: "كل Toolbox ليه رابط سري لوحده، وتقدر تغيّره أو تمسحه في أي وقت، والمساعد مش بيشوف غير السيناريوهات اللي اخترتها." },
          { icon: "history", h: "كل تشغيل متسجل", p: "أي أداة المساعد بيشغّلها بتظهر في سجل التشغيلات بخطواتها، زي أي تشغيل عادي." },
          { icon: "globe", h: "وبالعكس كمان", p: "خطوة «أداة من خادم MCP» بتخلّي سيناريوهاتك تستخدم أدوات أي خدمة تانية بتدعم MCP." },
        ].map((item, i) => (
          <article key={item.h} className="feature reveal" style={{ transitionDelay: `${i * 60}ms` }}>
            <div className="f-icon">
              <Icon name={item.icon} size={22} />
            </div>
            <h3>{item.h}</h3>
            <p>{item.p}</p>
          </article>
        ))}
      </div>

      <div className="cta reveal" style={{ marginTop: 50 }}>
        <h2>جرّب MCP دلوقتي</h2>
        <p>متاح في كل الباقات، والتشغيل بياخد كريديت عادي.</p>
        <Link className="btn primary lg" to={user ? "/app/mcp" : "/register"}>
          {user ? "افتح صفحة MCP" : "ابدأ مجاناً"}
        </Link>
      </div>
    </div>
  );
}
