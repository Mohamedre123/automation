import type { CredentialType, FieldDef, NodeDefinition } from "../engine/types.js";
import { aiCredentialTypes, aiNodes } from "./ai.js";
import { anthropicNodes } from "./anthropic.js";
import { commerceCredentials, commerceNodes } from "./commerce.js";
import { coreNodes } from "./core.js";
import { feedNodes } from "./feeds.js";
import { connectedCredentials, connectedNodes } from "./connected.js";
import { customApiCredential, customApiNode } from "./custom.js";
import { uploadPostCredential, uploadPostNode } from "./uploadpost.js";
import { aggregatorCredentials, aggregatorNodes } from "./aggregators.js";
import { credentialGuides } from "./guides.js";
import { googleCredential, googleNodes } from "./google.js";
import { httpCredentials, httpRequest } from "./http.js";
import { marketingCredentials, marketingNodes } from "./marketing.js";
import { mediaNodes, videoNode } from "./media.js";
import { messagingCredentials, messagingNodes } from "./messaging.js";
import { productivityCredentials, productivityNodes } from "./productivity.js";
import { publishAllNode } from "./publishAll.js";
import { publishingCredentials, publishingNodes } from "./publishing.js";
import { facebookCredential, instagramCredential, socialNodes } from "./social.js";
import { telegramCredential, telegramNodes } from "./telegram.js";
import { storeCredentials, storeNodes } from "./stores.js";
import { toolNodes } from "./tools.js";
import { wasenderCredential, wasenderNodes, whatsappCloudCredential, whatsappCloudNodes } from "./whatsapp.js";

// Adding an integration = one file exporting its nodes (+ credential type), registered here.
export const nodeDefinitions: NodeDefinition[] = [
  ...coreNodes,
  ...toolNodes,
  ...aiNodes,
  ...mediaNodes,
  videoNode,
  ...wasenderNodes,
  ...whatsappCloudNodes,
  ...telegramNodes,
  ...socialNodes,
  ...publishingNodes,
  publishAllNode,
  ...messagingNodes,
  ...googleNodes,
  ...productivityNodes,
  ...commerceNodes,
  ...storeNodes,
  ...marketingNodes,
  ...connectedNodes,
  ...feedNodes,
  httpRequest,
  customApiNode,
  uploadPostNode,
  ...aggregatorNodes,
  ...anthropicNodes,
];

export const credentialTypes: CredentialType[] = [
  ...aiCredentialTypes,
  ...connectedCredentials,
  wasenderCredential,
  whatsappCloudCredential,
  telegramCredential,
  facebookCredential,
  instagramCredential,
  ...publishingCredentials,
  ...messagingCredentials,
  googleCredential,
  ...productivityCredentials,
  ...commerceCredentials,
  ...storeCredentials,
  ...marketingCredentials,
  ...httpCredentials,
  customApiCredential,
  uploadPostCredential,
  ...aggregatorCredentials,
];

for (const type of credentialTypes) type.steps ??= credentialGuides[type.key];

// Publishing steps pick up the caption and media from the steps before them, so nobody wires them by hand.
const AUTO_FILL: Record<string, Record<string, NonNullable<FieldDef["autoFill"]>>> = {
  "social.publishAll": { caption: "caption", imageUrl: "image", videoUrl: "video", publishAt: "publishTime" },
  "uploadpost.post": { title: "caption", imageUrls: "images", videoUrl: "video", scheduledDate: "publishTime" },
  "ayrshare.post": { text: "caption", imageUrls: "images", videoUrl: "video", scheduledAt: "publishTime" },
  "zernio.post": { text: "caption", imageUrls: "images", videoUrl: "video", scheduledAt: "publishTime" },
  "blotato.post": { text: "caption", imageUrls: "images", videoUrl: "video", scheduledAt: "publishTime" },
  "facebook.post": { message: "caption", imageUrl: "image", videoUrl: "video" },
  "instagram.post": { caption: "caption", imageUrl: "image", videoUrl: "video" },
  "telegram.sendPhoto": { caption: "caption", photo: "image" },
  "telegram.sendVideo": { caption: "caption", video: "video" },
  "x.post": { text: "caption", imageUrl: "image" },
  "linkedin.post": { text: "caption" },
  "threads.post": { text: "caption", imageUrl: "image", videoUrl: "video" },
  "bluesky.post": { text: "caption", imageUrl: "image" },
  "pinterest.createPin": { description: "caption", imageUrl: "image" },
  "youtube.upload": { description: "caption", videoUrl: "video" },
  "tiktok.postVideo": { caption: "caption", videoUrl: "video" },
  "wordpress.createPost": { content: "caption", imageUrl: "image" },
  "drive.upload": { fileUrl: "image" },
  "ai.image": { referenceImage: "sourceImage" },
  "ai.video": { referenceImage: "sourceImage" },
  "ai.generate": { images: "sourceImage" },
};
for (const def of nodeDefinitions) {
  const map = AUTO_FILL[def.type];
  if (map) for (const field of def.fields) if (map[field.key]) field.autoFill = map[field.key];
}

const nodesByType = new Map(nodeDefinitions.map((n) => [n.type, n]));
const credentialsByKey = new Map(credentialTypes.map((c) => [c.key, c]));

export const getNode = (type: string) => nodesByType.get(type);
export const getCredentialType = (key: string) => credentialsByKey.get(key);
