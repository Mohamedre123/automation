import type { FastifyInstance, FastifyRequest } from "fastify";
import { decrypt, encrypt } from "../crypto.js";
import { db, newId, now } from "../db.js";
import type { CredentialType } from "../engine/types.js";
import { httpError, requireString } from "../errors.js";
import { getCredentialType } from "../nodes/index.js";
import { errorMessage } from "../nodes/util.js";

const mask = (value: string | undefined) => (!value ? "" : value.length <= 8 ? "••••••" : `••••••${value.slice(-4)}`);

function toSummary(row: any, userId: string) {
  const type = getCredentialType(row.type);
  const data = decrypt<Record<string, string>>(row.data);
  const usedBy = db
    .prepare("SELECT id, name FROM workflows WHERE user_id = ? AND instr(graph, ?) > 0")
    .all(userId, `"credentialId":"${row.id}"`);
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    preview: Object.fromEntries((type?.fields ?? []).map((f) => [f.key, f.secret ? mask(data[f.key]) : (data[f.key] ?? "")])),
    usedBy,
  };
}

function cleanData(type: CredentialType, input: unknown, existing: Record<string, string> = {}) {
  const raw = (input ?? {}) as Record<string, unknown>;
  const data: Record<string, string> = {};
  for (const field of type.fields) {
    const value = typeof raw[field.key] === "string" ? (raw[field.key] as string).trim() : "";
    data[field.key] = value || existing[field.key] || "";
    if (field.required && !data[field.key]) throw httpError(400, `حقل «${field.label}» مطلوب`);
  }
  return data;
}

async function runTest(type: CredentialType, data: Record<string, string>) {
  if (!type.test) return { ok: true, message: "اتحفظ (النوع ده مالوش اختبار تلقائي)" };
  try {
    return { ok: true, message: await type.test(data) };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

function getOwned(req: FastifyRequest, id: string) {
  const row = db.prepare("SELECT * FROM credentials WHERE id = ? AND user_id = ?").get(id, req.user.id) as any;
  if (!row) throw httpError(404, "الحساب مش موجود");
  return row;
}

const requireType = (key: unknown) => {
  const type = getCredentialType(String(key ?? ""));
  if (!type) throw httpError(400, "نوع حساب غير معروف");
  return type;
};

export async function credentialRoutes(app: FastifyInstance) {
  app.get("/api/credentials", async (req) => {
    const rows = db.prepare("SELECT * FROM credentials WHERE user_id = ? ORDER BY created_at DESC").all(req.user.id);
    return rows.map((row) => toSummary(row, req.user.id));
  });

  app.post("/api/credentials", async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const type = requireType(body.type);
    const name = requireString(body.name, "اسم الحساب", 120);
    const data = cleanData(type, body.data);
    const id = newId();
    const timestamp = now();
    db.prepare("INSERT INTO credentials (id, user_id, type, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      id,
      req.user.id,
      type.key,
      name,
      encrypt(data),
      timestamp,
      timestamp,
    );
    return toSummary(getOwned(req, id), req.user.id);
  });

  app.put("/api/credentials/:id", async (req) => {
    const { id } = req.params as { id: string };
    const row = getOwned(req, id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const type = requireType(row.type);
    const name = body.name === undefined ? row.name : requireString(body.name, "اسم الحساب", 120);
    const data = cleanData(type, body.data, decrypt(row.data));
    db.prepare("UPDATE credentials SET name = ?, data = ?, updated_at = ? WHERE id = ?").run(name, encrypt(data), now(), id);
    return toSummary(getOwned(req, id), req.user.id);
  });

  app.delete("/api/credentials/:id", async (req) => {
    const { id } = req.params as { id: string };
    getOwned(req, id);
    db.prepare("DELETE FROM credentials WHERE id = ?").run(id);
    return { ok: true };
  });

  app.post("/api/credentials/:id/test", async (req) => {
    const { id } = req.params as { id: string };
    const row = getOwned(req, id);
    return runTest(requireType(row.type), decrypt(row.data));
  });

  app.post("/api/credentials/test", async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const type = requireType(body.type);
    return runTest(type, cleanData(type, body.data));
  });
}
