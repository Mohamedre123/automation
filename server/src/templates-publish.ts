import type { Template } from "./templates.js";

/*
 * Publishing templates. All of them are the same shape on purpose:
 *
 *   متى؟  ->  الصور والكابشن  ->  النشر
 *
 * You fill one step - the pictures and the words - and the publishing step is already
 * pointing at it, so the only thing left to choose there is the account.
 */

const edge = (source: string, target: string) => ({ id: `e${source}-${target}`, source, target, sourceHandle: null });
const at = (x: number, y = 0) => ({ x: x * 280, y });
const chain = (...ids: string[]) => ids.slice(1).map((id, i) => edge(ids[i], id));

const LIBRARY = "صورك مرفوعة في «مكتبة الصور» (ارفعها مرة واحدة وسمّي كل صورة باسم تعرفه)";
const ONE_PLATFORM = "حساب منصة واحدة على الأقل: إنستجرام أو فيسبوك أو تيليجرام أو أي منصة تانية";
const AI_ACCOUNT = "حساب ذكاء اصطناعي: Gemini (فيه باقة مجانية) أو ChatGPT أو Claude";

/** The one step the customer fills: the pictures and the words that go with them. */
const gallery = (id: string, x: number, params: Record<string, unknown> = {}) => ({
  id,
  type: "media.gallery",
  name: "الصور والكابشن",
  position: at(x),
  params: { images: "", caption: "", ...params },
});

/** The publishing step, already wired to the gallery before it. */
const publish = (id: string, x: number, from: string, params: Record<string, unknown> = {}, name = "النشر") => ({
  id,
  type: "social.publishAll",
  name,
  position: at(x),
  params: { caption: `{{${from}.caption}}`, imageUrl: `{{${from}.list}}`, mediaMode: "image", ...params },
});

export const publishTemplates: Template[] = [
  {
    id: "post-now",
    name: "بوست دلوقتي: صورة وكابشن",
    description:
      "خطوة واحدة بتملاها: اكتب @ واختار الصورة واكتب الكابشن. خطوة النشر واخدة منها الصورة والكابشن لوحدها - انت بس بتختار الحساب وتدوس «تشغيل مرة»",
    category: "النشر",
    requires: [LIBRARY, ONE_PLATFORM],
    graph: {
      nodes: [
        { id: "1", type: "trigger.manual", name: "دوس تشغيل مرة", position: at(0), params: {} },
        gallery("2", 1),
        publish("3", 2, "2"),
      ],
      edges: chain("1", "2", "3"),
    },
  },
  {
    id: "carousel-now",
    name: "كاروسيل دلوقتي: كذا صورة بكابشن واحد",
    description:
      "اكتب @ واختار كل الصور اللي عايزها (لحد 10، كل صورة في سطر) واكتب كابشن واحد ليهم - ينزلوا كاروسيل على إنستجرام وألبوم على فيسبوك وتيليجرام",
    category: "النشر",
    requires: [LIBRARY, ONE_PLATFORM],
    graph: {
      nodes: [
        { id: "1", type: "trigger.manual", name: "دوس تشغيل مرة", position: at(0), params: {} },
        gallery("2", 1),
        publish("3", 2, "2", {}, "كاروسيل"),
      ],
      edges: chain("1", "2", "3"),
    },
  },
  {
    id: "carousel-schedule",
    name: "كاروسيل في ميعاد تحدده",
    description: "نفس الكاروسيل بس بميعاد: جهّزه في أي وقت، وهو ينزل لوحده في الساعة اللي كاتبها - مفيد للعروض والإطلاقات",
    category: "النشر",
    requires: [LIBRARY, ONE_PLATFORM],
    graph: {
      nodes: [
        {
          id: "1",
          type: "trigger.schedule",
          name: "الميعاد",
          position: at(0),
          params: { mode: "daily", time: "10:00", publishTime: "19:00", timezone: "Africa/Cairo" },
        },
        gallery("2", 1),
        publish("3", 2, "2", { publishAt: "{{1.publishAt}}", timezone: "Africa/Cairo" }, "كاروسيل"),
      ],
      edges: chain("1", "2", "3"),
    },
  },
  {
    id: "posts-from-list",
    name: "بوست لكل صورة بالكابشن اللي انت كاتبه",
    description:
      "اكتب @ واختار صورك، وجنب كل صورة اكتب الكابشن بتاعها في سطر - السيناريو ينشر بوست لكل صورة بالكابشن اللي كتبته ليها، من غير ذكاء اصطناعي",
    category: "النشر",
    requires: [LIBRARY, ONE_PLATFORM],
    graph: {
      nodes: [
        { id: "1", type: "trigger.manual", name: "دوس تشغيل مرة", position: at(0), params: {} },
        {
          id: "2",
          type: "media.select",
          name: "الصور وكابشن كل واحدة",
          position: at(1),
          params: { images: "", ideas: "", mode: "each" },
        },
        {
          id: "3",
          type: "social.publishAll",
          name: "النشر",
          position: at(2),
          params: { caption: "{{2.idea}}", imageUrl: "{{2.url}}", mediaMode: "image" },
        },
      ],
      edges: chain("1", "2", "3"),
    },
  },
  {
    id: "carousel-ai-caption",
    name: "كاروسيل والذكاء الاصطناعي يكتب الكابشن",
    description:
      "اختار الصور بـ @، واكتب سطر واحد عن الموضوع - الذكاء الاصطناعي يكتب كابشن بيع كامل بهاشتاجات، والكاروسيل ينزل بيه",
    category: "النشر",
    requires: [LIBRARY, AI_ACCOUNT, ONE_PLATFORM],
    graph: {
      nodes: [
        { id: "1", type: "trigger.manual", name: "دوس تشغيل مرة", position: at(0), params: {} },
        gallery("2", 1, { caption: "" }),
        {
          id: "3",
          type: "ai.generate",
          name: "كتابة الكابشن",
          position: at(2),
          params: {
            system:
              "أنت كوبي رايتر سوشيال ميديا باللهجة المصرية. اكتب كابشن بوست واحد: أول سطر يشد الانتباه، بعده الفايدة في سطرين، بعده CTA واضح، وفي الآخر من 8 لـ 12 هاشتاج. اكتب الكابشن بس من غير أي شرح.",
            prompt: "اكتب كابشن لبوست عن: (اكتب هنا موضوع البوست - مثلاً مجموعة الشنط الجديدة، خصم 20% لحد الجمعة)",
            maxTokens: 900,
          },
        },
        publish("4", 3, "2", { caption: "{{3.text}}" }, "كاروسيل"),
      ],
      edges: chain("1", "2", "3", "4"),
    },
  },
  {
    id: "reel-now",
    name: "ريل / فيديو دلوقتي",
    description: "اكتب @ واختار الفيديو من مكتبتك واكتب الكابشن - ينزل ريل على إنستجرام وفيديو على فيسبوك وتيليجرام",
    category: "النشر",
    requires: ["فيديو مرفوع في «مكتبة الصور» (MP4، أقل من 100 ميجا)", ONE_PLATFORM],
    graph: {
      nodes: [
        { id: "1", type: "trigger.manual", name: "دوس تشغيل مرة", position: at(0), params: {} },
        { id: "2", type: "media.gallery", name: "الفيديو والكابشن", position: at(1), params: { images: "", caption: "", video: "" } },
        publish("3", 2, "2", { imageUrl: "", videoUrl: "{{2.video}}", mediaMode: "video" }, "نشر الريل"),
      ],
      edges: chain("1", "2", "3"),
    },
  },
  {
    id: "telegram-album",
    name: "ألبوم صور لقناة تيليجرام",
    description: "اختار صورك بـ @ واكتب اليوزرنيم بتاع قناتك - كل الصور تنزل في رسالة واحدة والتعليق على أولها",
    category: "النشر",
    requires: [LIBRARY, "بوت تيليجرام أدمن في قناتك"],
    graph: {
      nodes: [
        { id: "1", type: "trigger.manual", name: "دوس تشغيل مرة", position: at(0), params: {} },
        gallery("2", 1),
        {
          id: "3",
          type: "telegram.sendAlbum",
          name: "ألبوم للقناة",
          position: at(2),
          params: { chatId: "@my_channel", photos: "{{2.list}}", caption: "{{2.caption}}" },
        },
      ],
      edges: chain("1", "2", "3"),
    },
  },
  {
    id: "daily-library-post",
    name: "بوست كل يوم من مكتبة صورك بالترتيب",
    description:
      "حدد الفولدر وخلاص: كل يوم في الميعاد بياخد الصورة اللي عليها الدور وينشرها بالكابشن اللي انت كاتبه - ولما الصور تخلص يبدأ من الأول",
    category: "النشر",
    requires: ["فولدر صور في «مكتبة الصور» (مثلاً «منتجات»)", ONE_PLATFORM],
    graph: {
      nodes: [
        {
          id: "1",
          type: "trigger.schedule",
          name: "كل يوم",
          position: at(0),
          params: { mode: "daily", time: "10:00", publishTime: "19:00", timezone: "Africa/Cairo" },
        },
        { id: "2", type: "media.pick", name: "صورة النهاردة", position: at(1), params: { folder: "منتجات", mode: "sequential" } },
        {
          id: "3",
          type: "social.publishAll",
          name: "النشر",
          position: at(2),
          params: {
            caption: "{{2.name}}\n\nمتاح دلوقتي - كلّمنا للطلب",
            imageUrl: "{{2.url}}",
            mediaMode: "image",
            publishAt: "{{1.publishAt}}",
            timezone: "Africa/Cairo",
          },
        },
      ],
      edges: chain("1", "2", "3"),
    },
  },
];
