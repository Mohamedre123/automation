import type { CredentialType, NodeDefinition } from "../engine/types.js";
import { aiCredentialTypes, aiNodes } from "./ai.js";
import { anthropicNodes } from "./anthropic.js";
import { commerceCredentials, commerceNodes } from "./commerce.js";
import { coreNodes } from "./core.js";
import { feedNodes } from "./feeds.js";
import { googleCredential, googleNodes } from "./google.js";
import { httpCredentials, httpRequest } from "./http.js";
import { marketingCredentials, marketingNodes } from "./marketing.js";
import { mediaNodes } from "./media.js";
import { messagingCredentials, messagingNodes } from "./messaging.js";
import { productivityCredentials, productivityNodes } from "./productivity.js";
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
  ...wasenderNodes,
  ...whatsappCloudNodes,
  ...telegramNodes,
  ...socialNodes,
  ...publishingNodes,
  ...messagingNodes,
  ...googleNodes,
  ...productivityNodes,
  ...commerceNodes,
  ...storeNodes,
  ...marketingNodes,
  ...feedNodes,
  httpRequest,
  ...anthropicNodes,
];

export const credentialTypes: CredentialType[] = [
  ...aiCredentialTypes,
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
];

const nodesByType = new Map(nodeDefinitions.map((n) => [n.type, n]));
const credentialsByKey = new Map(credentialTypes.map((c) => [c.key, c]));

export const getNode = (type: string) => nodesByType.get(type);
export const getCredentialType = (key: string) => credentialsByKey.get(key);
