import type { CredentialType, NodeDefinition } from "../engine/types.js";
import { aiCredentialTypes, aiNodes } from "./ai.js";
import { anthropicNodes } from "./anthropic.js";
import { coreNodes } from "./core.js";
import { httpCredentials, httpRequest } from "./http.js";
import { mediaNodes } from "./media.js";
import { facebookCredential, instagramCredential, socialNodes } from "./social.js";
import { telegramCredential, telegramNodes } from "./telegram.js";
import { wasenderCredential, wasenderNodes, whatsappCloudCredential, whatsappCloudNodes } from "./whatsapp.js";

// Adding an integration = one file exporting its nodes (+ credential type), registered here.
export const nodeDefinitions: NodeDefinition[] = [
  ...coreNodes,
  ...aiNodes,
  ...mediaNodes,
  ...wasenderNodes,
  ...whatsappCloudNodes,
  ...telegramNodes,
  ...socialNodes,
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
  ...httpCredentials,
];

const nodesByType = new Map(nodeDefinitions.map((n) => [n.type, n]));
const credentialsByKey = new Map(credentialTypes.map((c) => [c.key, c]));

export const getNode = (type: string) => nodesByType.get(type);
export const getCredentialType = (key: string) => credentialsByKey.get(key);
