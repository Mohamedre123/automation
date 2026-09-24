import type { FastifyInstance, FastifyRequest } from "fastify";
import { one, parseJson } from "../db.js";
import type { WorkflowGraph } from "../engine/types.js";
import { httpError } from "../errors.js";
import { answerFromApp, importFromApp } from "../nodes/ai.js";
import { addFact, readLearning, saveLearning, type Learning } from "../nodes/learning.js";
import { errorMessage } from "../nodes/util.js";

/*
 * What a scenario's chatbot has learned, for the owner to see and correct in the app: every fact
 * it keeps (and where it came from), the questions waiting for an answer, and the two ways to teach
 * it without a phone - write a fact, or paste old conversations.
 */

async function ownedWorkflow(req: FastifyRequest) {
  const { id } = req.params as { id: string };
  const row = await one<{ id: string; user_id: string; graph: string }>("SELECT id, user_id, graph FROM workflows WHERE id = $1 AND user_id = $2", [
    id,
    req.user.id,
  ]);
  if (!row) throw httpError(404, "السيناريو مش موجود");
  return { id: row.id, userId: row.user_id, graph: parseJson<WorkflowGraph>(row.graph, { nodes: [], edges: [] }) };
}

const view = (state: Learning) => ({ facts: [...state.facts].reverse(), open: [...state.open].reverse() });

const cleanText = (value: unknown, label: string, max: number) => {
  const text = String(value ?? "").trim();
  if (!text) throw httpError(400, `${label} فاضي`);
  if (text.length > max) throw httpError(400, `${label} طويل أوي (أقصى ${max} حرف)`);
  return text;
};

export async function learningRoutes(app: FastifyInstance) {
  app.get("/api/workflows/:id/learning", async (req) => {
    const workflow = await ownedWorkflow(req);
    return view(await readLearning(req.user.id, workflow.id));
  });

  /* A fact the owner writes in the app goes in exactly as written. */
  app.post("/api/workflows/:id/learning/facts", async (req) => {
    const workflow = await ownedWorkflow(req);
    const text = cleanText((req.body as any)?.text, "المعلومة", 600);
    const state = await readLearning(req.user.id, workflow.id);
    addFact(state, text, "app");
    await saveLearning(req.user.id, workflow.id, state);
    return view(state);
  });

  app.put("/api/workflows/:id/learning/facts/:factId", async (req) => {
    const workflow = await ownedWorkflow(req);
    const factId = Number((req.params as any).factId);
    const text = cleanText((req.body as any)?.text, "المعلومة", 600);
    const state = await readLearning(req.user.id, workflow.id);
    const fact = state.facts.find((f) => f.id === factId);
    if (!fact) throw httpError(404, "المعلومة دي مش موجودة");
    fact.text = text;
    fact.source = "app";
    fact.at = new Date().toISOString();
    await saveLearning(req.user.id, workflow.id, state);
    return view(state);
  });

  app.delete("/api/workflows/:id/learning/facts/:factId", async (req) => {
    const workflow = await ownedWorkflow(req);
    const factId = Number((req.params as any).factId);
    const state = await readLearning(req.user.id, workflow.id);
    state.facts = state.facts.filter((f) => f.id !== factId);
    await saveLearning(req.user.id, workflow.id, state);
    return view(state);
  });

  /* Answering a waiting question from the app: it goes to the customer and the bot keeps it. */
  app.post("/api/workflows/:id/learning/open/:questionId/answer", async (req) => {
    const workflow = await ownedWorkflow(req);
    const questionId = Number((req.params as any).questionId);
    const text = cleanText((req.body as any)?.text, "الإجابة", 4000);
    const { reply, learning } = await answerFromApp(workflow, questionId, text);
    return { ...view(learning), message: reply };
  });

  app.delete("/api/workflows/:id/learning/open/:questionId", async (req) => {
    const workflow = await ownedWorkflow(req);
    const questionId = Number((req.params as any).questionId);
    const state = await readLearning(req.user.id, workflow.id);
    state.open = state.open.filter((q) => q.id !== questionId);
    await saveLearning(req.user.id, workflow.id, state);
    return view(state);
  });

  /* Old conversations, an exported WhatsApp chat, an FAQ or a price list: the facts in them. */
  app.post("/api/workflows/:id/learning/import", async (req) => {
    const workflow = await ownedWorkflow(req);
    const text = cleanText((req.body as any)?.text, "الكلام", 60_000);
    try {
      const { added, learning } = await importFromApp(workflow, text);
      return { ...view(learning), added: added.length };
    } catch (e) {
      throw httpError(400, errorMessage(e));
    }
  });
}
