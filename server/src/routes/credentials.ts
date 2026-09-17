import type { FastifyInstance, FastifyRequest } from "fastify";
import { decrypt, encrypt } from "../crypto.js";
import { newId, now, one, query, run } from "../db.js";
import type { CredentialType } from "../engine/types.js";
import { httpError, requireString } from "../errors.js";
import { getCredentialType } from "../nodes/index.js";
import { listModels } from "../nodes/models.js";
import { errorMessage } from "../nodes/util.js";
import { rateLimit } from "../protection.js";

const mask = (value: string | undefined) => (!value ? "" : value.length <= 8 ? "••••••" : `••••••${value.slice(-4)}`);

async function toSummary(row: any, userId: string) {
  const type = getCredentialType(row.type);
  const data = decrypt<Record<string, string>>(row.data);
  const usedBy = await query("SELECT id, name FROM workflows WHERE user_id = $1 AND strpos(graph, $2) > 0", [
    userId,
    `"credentialId":"${row.id}"`,
  ]);
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    preview: Object.fromEntries(
      (type?.fields ?? []).map((f) => {
        const value = data[f.key] ?? "";
        return [f.key, f.secret || (value.length > 48 && !/^https?:\/\//.test(value)) ? mask(value) : value];
      }),
    ),
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
  if (type.key === "customApi" && data.authHeader && !/^[A-Za-z0-9-]{1,60}$/.test(data.authHeader)) {
    throw httpError(400, "«اسم Header المفتاح» لازم يكون اسم قصير زي Authorization أو X-API-Key - المفتاح نفسه اكتبه في «قيمة المفتاح»");
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

async function getOwned(req: FastifyRequest, id: string) {
  const row = await one("SELECT * FROM credentials WHERE id = $1 AND user_id = $2", [id, req.user.id]);
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
    const rows = await query("SELECT * FROM credentials WHERE user_id = $1 ORDER BY created_at DESC", [req.user.id]);
    return Promise.all(rows.map((row) => toSummary(row, req.user.id)));
  });

  app.post("/api/credentials", async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const type = requireType(body.type);
    const name = requireString(body.name, "اسم الحساب", 120);
    const data = cleanData(type, body.data);
    const id = newId();
    const timestamp = now();
    await run("INSERT INTO credentials (id, user_id, type, name, data, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
      id,
      req.user.id,
      type.key,
      name,
      encrypt(data),
      timestamp,
      timestamp,
    ]);
    return toSummary(await getOwned(req, id), req.user.id);
  });

  app.put("/api/credentials/:id", async (req) => {
    const { id } = req.params as { id: string };
    const row = await getOwned(req, id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const type = requireType(row.type);
    const name = body.name === undefined ? row.name : requireString(body.name, "اسم الحساب", 120);
    const data = cleanData(type, body.data, decrypt(row.data));
    await run("UPDATE credentials SET name = $1, data = $2, updated_at = $3 WHERE id = $4", [name, encrypt(data), now(), id]);
    return toSummary(await getOwned(req, id), req.user.id);
  });

  app.delete("/api/credentials/:id", async (req) => {
    const { id } = req.params as { id: string };
    await getOwned(req, id);
    await run("DELETE FROM credentials WHERE id = $1", [id]);
    return { ok: true };
  });

  app.get("/api/credentials/:id/models", async (req) => {
    const { id } = req.params as { id: string };
    const row = await getOwned(req, id);
    const type = requireType(row.type);
    try {
      const data = decrypt<Record<string, string>>(row.data);
      const models = await listModels({ id: row.id, type: row.type, data });
      return { models, defaultModel: (row.type === "customAiApi" ? data.model : type.defaultModel) ?? null };
    } catch (error) {
      // Still usable offline: the static suggestions come back with the error.
      return { models: type.models ?? [], defaultModel: type.defaultModel ?? null, error: errorMessage(error) };
    }
  });

  app.post("/api/credentials/:id/test", async (req) => {
    await rateLimit(`cred-test:${req.user.id}`, 30, 600);
    const { id } = req.params as { id: string };
    const row = await getOwned(req, id);
    return runTest(requireType(row.type), decrypt(row.data));
  });

  app.post("/api/credentials/test", async (req) => {
    await rateLimit(`cred-test:${req.user.id}`, 30, 600);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const type = requireType(body.type);
    return runTest(type, cleanData(type, body.data));
  });
}
