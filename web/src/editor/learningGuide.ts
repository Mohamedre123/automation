/*
 * How to switch on a chatbot's learning and try it, in plain words - one source for the section
 * inside the AI Agent step, the scenario's step-by-step guide and the help center, so all three
 * say the same thing. The steps change with the channel the customers write on, because what the
 * bot can see differs: WasenderAPI shows the owner's own replies, official WhatsApp and Telegram
 * do not, and a form or webhook has no chat to answer on at all.
 */

export type LearnChannel = "wasender" | "whatsapp" | "telegram" | "other";

export const learnChannel = (triggerType: string | undefined): LearnChannel =>
  triggerType === "wasender.trigger"
    ? "wasender"
    : triggerType === "whatsapp.trigger"
      ? "whatsapp"
      : triggerType === "telegram.trigger"
        ? "telegram"
        : "other";

export interface SetupStep {
  text: string;
  /** Known to be done (true), known to be missing (false), or something we cannot check (undefined). */
  done?: boolean;
}

/** What the owner does once, before the bot can learn from them. */
export function learningSetup(channel: LearnChannel, params: Record<string, any>): SetupStep[] {
  const learnOn = params.learn !== false;
  const hasOwner = Boolean(String(params.ownerContact ?? "").trim() || String(params.handoffTarget ?? "").trim());
  const steps: SetupStep[] = [{ text: "فوق في إعدادات الخطوة: خلي «يتعلم لوحده من ردودك» مفعّل", done: learnOn }];

  if (channel === "other") {
    steps.push({
      text: "المحفّز هنا مش شات (فورم أو Webhook)، فالبوت ميقدرش يبعتلك الأسئلة على موبايلك. علّمه من خطوة البوت تحت «اللي البوت اتعلمه»: اكتب المعلومات في «علّمه معلومة» أو الزق محادثات قديمة، والأسئلة اللي ميعرفهاش هتظهر هناك ترد عليها - إجابتك بتتحفظ للي بعده",
    });
    return steps;
  }

  steps.push({
    text:
      channel === "telegram"
        ? "اكتب في «رقمك انت» يوزرنيمك في تيليجرام، زي ‎@my_name (هتلاقيه في تيليجرام ← الإعدادات ← Username)"
        : channel === "wasender"
          ? "اكتب في «رقمك انت» رقمك الشخصي بكود الدولة من غير +، زي 201012345678. لازم يكون رقم تاني غير الرقم المربوط بالبوت - البوت نفسه شغال على رقم المحل"
          : "اكتب في «رقمك انت» رقمك الشخصي بكود الدولة من غير +، زي 201012345678 - رقم تاني غير رقم الشركة",
    done: hasOwner,
  });

  if (channel === "telegram") {
    steps.push({ text: "من حسابك انت افتح البوت في تيليجرام وابعتله /start مرة واحدة - تيليجرام مش بيسمح لبوت يبعت لحد مكلّمهوش الأول" });
  }
  if (channel === "whatsapp") {
    steps.push({
      text: "ابعت للبوت أي رسالة من رقمك (زي «أهلاً») قبل ما تبدأ - واتساب الرسمي بيسمح للبوت يبعتلك بس لو انت كلمته خلال آخر 24 ساعة",
    });
  }
  if (channel === "wasender") {
    steps.push({
      text: "عشان البوت يشوف ردودك انت من موبايلك ويتعلم منها: ادخل WasenderAPI ← الجلسة بتاعتك ← Webhooks، وجنب Message Received علّم كمان على Message Upsert، واحفظ",
    });
  }
  steps.push({ text: "دوس «حفظ» فوق، وتأكد إن السيناريو مفعّل - البوت بيشتغل بآخر نسخة محفوظة" });
  return steps;
}

/** A two-minute check that it all works, with a second phone. */
export function learningTryIt(channel: LearnChannel): string[] {
  if (channel === "other") {
    return [
      "في خطوة البوت اكتب في «علّمه معلومة» حاجة مش موجودة في «المعلومات»، زي «الشحن لإسكندرية 70 جنيه»",
      "شغّل السيناريو واسأل عنها ← البوت هيرد بيها",
      "اسأل حاجة مش مكتوبة خالص ← هتلاقي السؤال ظهر في خطوة البوت تحت «أسئلة عملاء مستنية إجابتك»، اكتب إجابته واحفظها",
    ];
  }
  const where = channel === "telegram" ? "حساب تيليجرام تاني" : "رقم تاني (موبايل حد من البيت مثلاً)";
  const steps = [
    "من رقمك انت ابعت للبوت: «اتعلم: الشحن لإسكندرية 70 جنيه» ← هيرد «حفظتها ✓» وهتظهر في «اللي البوت اتعلمه» في خطوة البوت",
    `من ${where} اسأل البوت حاجة مش في المعلومات، زي «عندكم لون أحمر؟» ← هيقوله إنه هيتأكد، ويوصلك انت السؤال برقم`,
    "رد على البوت من رقمك بالرقم اللي وصلك، زي: «رد 1: أيوه موجود بـ 350» ← إجابتك بتروح للعميل التاني، والبوت بيحفظها",
    `اسأل نفس السؤال تاني من ${where} ← المرة دي البوت هيرد لوحده من غير ما يسألك`,
  ];
  if (channel === "wasender") steps.push("ولو رديت على أي عميل من موبايلك عادي، هتلاقي ردك اتحفظ في «اللي البوت اتعلمه» ومكتوب جنبه «ردك على عميل من موبايلك»");
  return steps;
}

/** What the owner can send the bot from their own number. */
export const LEARN_COMMANDS: { say: string; does: string }[] = [
  { say: "اتعلم: المعلومة", does: "يحفظها ويرد بيها على العملاء. لو فيه معلومة قديمة عكسها بيشيلها" },
  { say: "رد 3: الإجابة", does: "يبعت الإجابة للعميل صاحب السؤال رقم 3، ويحفظها للمرة الجاية" },
  { say: "الأسئلة", does: "يعرضلك الأسئلة اللي مستنية إجابتك بأرقامها" },
  { say: "اللي اتعلمته", does: "يعرضلك كل اللي حافظه بأرقامه" },
  { say: "انسى: الموضوع أو رقمه", does: "يمسح المعلومة دي" },
  { say: "مساعدة", does: "يبعتلك الأوامر دي" },
];
