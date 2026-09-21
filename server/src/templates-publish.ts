import type { Template } from "./templates.js";

/*
 * Publishing templates: upload images once, write what goes with them, publish.
 * Every one of these starts from the image library, so there is nothing to wire by hand -
 * the customer writes @ in the images box and picks, and that is the whole setup.
 */

const edge = (source: string, target: string) => ({ id: `e${source}-${target}`, source, target, sourceHandle: null });
const at = (x: number, y = 0) => ({ x: x * 280, y });
const chain = (...ids: string[]) => ids.slice(1).map((id, i) => edge(ids[i], id));

const LIBRARY = "صورك مرفوعة في «مكتبة الصور» (ارفعها مرة واحدة وسمّي كل صورة باسم تعرفه)";
const ONE_PLATFORM = "حساب منصة واحدة على الأقل: إنستجرام أو فيسبوك أو تيليجرام أو أي منصة تانية";
const AI_ACCOUNT = "حساب ذكاء اصطناعي: Gemini (فيه باقة مجانية) أو ChatGPT أو Claude";

/** Every publish step looks the same; only the images and the caption change. */
const publish = (id: string, x: number, params: Record<string, unknown>, name = "النشر") => ({
  id,
  type: "social.publishAll",
  name,
  position: at(x),
  params: { mediaMode: "image", ...params },
});

export const publishTemplates: Template[] = [
  {
    id: "post-now",
    name: "بوست دلوقتي: صورة وكابشن",
    description:
      "أبسط حاجة ممكنة: اكتب @ واختار الصورة، اكتب الكابشن، ودوس «تشغيل مرة» - البوست ينزل على كل المنصات اللي ربطتها في نفس اللحظة",
    category: "النشر",
    requires: [LIBRARY, ONE_PLATFORM],
    graph: {
      nodes: [
        { id: "1", type: "trigger.manual", name: "دوس تشغيل مرة", position: at(0), params: {} },
        publish("2", 1, {
          caption: "اكتب الكابشن هنا قبل ما تشغّل",
          imageUrl: "",
        }),
      ],
      edges: chain("1", "2"),
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
        publish("2", 1, {
          caption: "اكتب الكابشن هنا - هو نفسه لكل الصور",
          imageUrl: "",
        }, "كاروسيل"),
      ],
      edges: chain("1", "2"),
    },
  },
  {
    id: "carousel-schedule",
    name: "كاروسيل في ميعاد تحدده",
    description: "نفس الكاروسيل بس بميعاد: تجهّزه في أي وقت، وهو ينزل لوحده في الساعة اللي كاتبها - مفيد للعروض والإطلاقات",
    category: "النشر",
    requires: [LIBRARY, ONE_PLATFORM],
    graph: {
      nodes: [
        { id: "1", type: "trigger.schedule", name: "الميعاد", position: at(0), params: { mode: "daily", time: "10:00", timezone: "Africa/Cairo" } },
        publish("2", 1, {
          caption: "اكتب الكابشن هنا - هو نفسه لكل الصور",
          imageUrl: "",
          publishAt: "19:00",
          timezone: "Africa/Cairo",
        }, "كاروسيل"),
      ],
      edges: chain("1", "2"),
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
        publish("3", 2, { caption: "{{2.idea}}", imageUrl: "{{2.url}}" }),
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
        {
          id: "2",
          type: "ai.generate",
          name: "كتابة الكابشن",
          position: at(1),
          params: {
            system:
              "أنت كوبي رايتر سوشيال ميديا باللهجة المصرية. اكتب كابشن بوست واحد: أول سطر يشد الانتباه، بعده الفايدة في سطرين، بعده CTA واضح، وفي الآخر من 8 لـ 12 هاشتاج. اكتب الكابشن بس من غير أي شرح.",
            prompt: "اكتب كابشن لبوست عن: (اكتب هنا موضوع البوست - مثلاً مجموعة الشنط الجديدة، خصم 20% لحد الجمعة)",
            maxTokens: 900,
          },
        },
        publish("3", 2, { caption: "{{2.text}}", imageUrl: "" }, "كاروسيل"),
      ],
      edges: chain("1", "2", "3"),
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
        publish("2", 1, { caption: "اكتب كابشن الريل هنا", videoUrl: "", mediaMode: "video" }, "نشر الريل"),
      ],
      edges: chain("1", "2"),
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
        {
          id: "2",
          type: "telegram.sendAlbum",
          name: "ألبوم للقناة",
          position: at(1),
          params: { chatId: "@my_channel", photos: "", caption: "اكتب التعليق هنا" },
        },
      ],
      edges: chain("1", "2"),
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
        { id: "1", type: "trigger.schedule", name: "كل يوم", position: at(0), params: { mode: "daily", time: "10:00", publishTime: "19:00", timezone: "Africa/Cairo" } },
        { id: "2", type: "media.pick", name: "صورة النهاردة", position: at(1), params: { folder: "منتجات", mode: "sequential" } },
        publish("3", 2, { caption: "{{2.name}}\n\nمتاح دلوقتي - كلّمنا للطلب", imageUrl: "{{2.url}}" }),
      ],
      edges: chain("1", "2", "3"),
    },
  },
];
