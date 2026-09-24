/** Hand-built scenarios, the picture-size reader, and the runtime fallback. */
const base = new URL("../dist/", import.meta.url).href;
const { getNode } = await import(base + "nodes/index.js");
const { wireGraph, autoFillFromRun } = await import(base + "engine/autofill.js");
const { imageSize } = await import(base + "nodes/media.js");

let pass = 0;
const fail = [];
const check = (ok, what) => (ok ? pass++ : fail.push(what));

const at = (x) => ({ x: x * 280, y: 0 });
const edge = (a, b) => ({ id: `e${a}-${b}`, source: a, target: b, sourceHandle: null });

/* 1. What the customer described: when, then pictures + words, then publish. */
{
  const graph = {
    nodes: [
      { id: "1", type: "trigger.schedule", position: at(0), params: { mode: "daily", time: "09:00", publishTime: "19:00" } },
      { id: "2", type: "media.gallery", position: at(1), params: { images: "@{تيشيرت}", caption: "الكابشن بتاعي" } },
      { id: "3", type: "instagram.post", position: at(2), params: {} },
    ],
    edges: [edge("1", "2"), edge("2", "3")],
  };
  const wired = wireGraph(graph, getNode).nodes.find((n) => n.id === "3").params;
  check(wired.caption === "{{2.caption}}", `instagram caption wired (got ${wired.caption})`);
  check(wired.imageUrl === "{{2.list}}", `instagram images wired (got ${wired.imageUrl})`);
}

/* 2. Same for every other publishing step, plus messages. */
for (const [type, captionKey, mediaKey] of [
  ["facebook.post", "message", "imageUrl"],
  ["x.post", "text", "imageUrl"],
  ["threads.post", "text", "imageUrl"],
  ["bluesky.post", "text", "imageUrl"],
  ["pinterest.createPin", "description", "imageUrl"],
  ["linkedin.post", "text", null],
  ["telegram.sendAlbum", "caption", "photos"],
  ["telegram.sendPhoto", "caption", "photo"],
  ["telegram.sendMessage", "text", null],
  ["wasender.send", "text", "mediaUrl"],
  ["whatsapp.send", "text", "mediaUrl"],
  ["social.publishAll", "caption", "imageUrl"],
  ["uploadpost.post", "title", "imageUrls"],
]) {
  const graph = {
    nodes: [
      { id: "1", type: "trigger.manual", position: at(0), params: {} },
      { id: "2", type: "media.gallery", position: at(1), params: { images: "@{تيشيرت}", caption: "كابشن" } },
      { id: "3", type, position: at(2), params: {} },
    ],
    edges: [edge("1", "2"), edge("2", "3")],
  };
  const wired = wireGraph(graph, getNode).nodes.find((n) => n.id === "3").params;
  check(wired[captionKey] === "{{2.caption}}", `${type}.${captionKey} wired (got ${wired[captionKey]})`);
  if (mediaKey) check(wired[mediaKey] === "{{2.list}}", `${type}.${mediaKey} wired (got ${wired[mediaKey]})`);
}

/* 3. An AI step before the publish step still wins for the caption. */
{
  const graph = {
    nodes: [
      { id: "1", type: "trigger.manual", position: at(0), params: {} },
      { id: "2", type: "media.pick", position: at(1), params: { folder: "منتجات" } },
      { id: "3", type: "ai.generate", position: at(2), params: { system: 'رد بـ JSON: {"post":"..."}', parseJson: true } },
      { id: "4", type: "social.publishAll", position: at(3), params: {} },
    ],
    edges: [edge("1", "2"), edge("2", "3"), edge("3", "4")],
  };
  const wired = wireGraph(graph, getNode).nodes.find((n) => n.id === "4").params;
  check(wired.caption === "{{3.json.post}}", `AI caption wired (got ${wired.caption})`);
  check(wired.imageUrl === "{{2.url}}", `library image wired (got ${wired.imageUrl})`);
}

/* 4. Nothing the customer wrote is ever replaced. */
{
  const graph = {
    nodes: [
      { id: "1", type: "trigger.manual", position: at(0), params: {} },
      { id: "2", type: "media.gallery", position: at(1), params: { images: "@{a}", caption: "من الجاليري" } },
      { id: "3", type: "instagram.post", position: at(2), params: { caption: "الكابشن اللي انا كتبته", imageUrl: "https://example.com/a.jpg" } },
    ],
    edges: [edge("1", "2"), edge("2", "3")],
  };
  const wired = wireGraph(graph, getNode).nodes.find((n) => n.id === "3").params;
  check(wired.caption === "الكابشن اللي انا كتبته", "a written caption is kept");
  check(wired.imageUrl === "https://example.com/a.jpg", "a written image is kept");
}

/* 5. A step with nothing before it is left alone. */
{
  const graph = { nodes: [{ id: "1", type: "instagram.post", position: at(0), params: {} }], edges: [] };
  check(wireGraph(graph, getNode).nodes[0].params.caption === undefined, "nothing before = nothing wired");
}

/* 6. Runtime fallback: an empty box still takes what ran before it. */
{
  const graph = {
    nodes: [
      { id: "1", type: "trigger.manual", position: at(0), params: {} },
      { id: "2", type: "media.gallery", position: at(1), params: {} },
      { id: "3", type: "instagram.post", position: at(2), params: {} },
    ],
    edges: [edge("1", "2"), edge("2", "3")],
  };
  const outputs = { 1: {}, 2: { list: "https://x/a.jpg\nhttps://x/b.jpg", url: "https://x/a.jpg", caption: "كابشن التشغيل", video: "" } };
  const filled = autoFillFromRun(getNode("instagram.post"), graph.nodes[2], { caption: "", imageUrl: "", videoUrl: "" }, graph, outputs);
  check(filled.caption === "كابشن التشغيل", `runtime caption (got ${filled.caption})`);
  check(filled.imageUrl === "https://x/a.jpg\nhttps://x/b.jpg", `runtime gallery (got ${filled.imageUrl})`);
}

/* 7. Reading a picture's size out of its header. */
{
  const png = Buffer.alloc(24);
  png.writeUInt32BE(0x89504e47, 0);
  png.writeUInt32BE(1080, 16);
  png.writeUInt32BE(1350, 20);
  const pngSize = imageSize(png);
  check(pngSize?.width === 1080 && pngSize?.height === 1350, `PNG size (got ${JSON.stringify(pngSize)})`);

  // Minimal JPEG: SOI, an APP0 block, then SOF0 carrying the size.
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]),
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]),
    (() => {
      const b = Buffer.alloc(4);
      b.writeUInt16BE(1920, 0);
      b.writeUInt16BE(1080, 2);
      return b;
    })(),
    Buffer.alloc(10),
  ]);
  const jpegSize = imageSize(jpeg);
  check(jpegSize?.width === 1080 && jpegSize?.height === 1920, `JPEG size (got ${JSON.stringify(jpegSize)})`);

  const gif = Buffer.concat([Buffer.from("GIF89a"), (() => { const b = Buffer.alloc(18); b.writeUInt16LE(800, 0); b.writeUInt16LE(600, 2); return b; })()]);
  const gifSize = imageSize(gif);
  check(gifSize?.width === 800 && gifSize?.height === 600, `GIF size (got ${JSON.stringify(gifSize)})`);
  check(imageSize(Buffer.from("not an image at all, really")) === null, "unknown bytes give no size");
}

/* 8. The shape choice exists on the steps that can crop. */
for (const type of ["instagram.post", "social.publishAll"]) {
  const fit = getNode(type).fields.find((f) => f.key === "fit");
  check(fit?.default === "keep", `${type}: keeps the picture whole by default`);
  check(fit?.options?.some((o) => o.value === "crop"), `${type}: cropping is opt-in`);
}

console.log(`${pass} passed, ${fail.length} failed`);
for (const f of fail) console.log("  FAIL", f);
process.exit(fail.length ? 1 : 0);
