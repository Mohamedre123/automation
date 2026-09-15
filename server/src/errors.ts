export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const httpError = (statusCode: number, message: string) => new HttpError(statusCode, message);

export function requireString(value: unknown, label: string, max = 500): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw httpError(400, `${label} مطلوب`);
  if (text.length > max) throw httpError(400, `${label} طويل جداً`);
  return text;
}
