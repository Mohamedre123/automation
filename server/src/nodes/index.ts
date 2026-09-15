import type { CredentialType, NodeDefinition } from "../engine/types.js";
import { aiCredentialTypes, aiNodes } from "./ai.js";
import { anthropicNodes } from "./anthropic.js";
import { coreNodes } from "./core.js";
import { httpCredentials, httpRequest } from "./http.js";
import { telegramCredential, telegramNodes } from "./telegram.js";

// Adding an integration = one file exporting its nodes (+ credential type), registered here.
export const nodeDefinitions: NodeDefinition[] = [...coreNodes, ...aiNodes, httpRequest, ...telegramNodes, ...anthropicNodes];

export const credentialTypes: CredentialType[] = [...aiCredentialTypes, telegramCredential, ...httpCredentials];

const nodesByType = new Map(nodeDefinitions.map((n) => [n.type, n]));
const credentialsByKey = new Map(credentialTypes.map((c) => [c.key, c]));

export const getNode = (type: string) => nodesByType.get(type);
export const getCredentialType = (key: string) => credentialsByKey.get(key);
