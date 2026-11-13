import type { FastifyReply } from "fastify";
import { t } from "../i18n/index.js";

/**
 * API errors carry a translation key (`code`) + params so the dashboard can show them in the
 * user's language; `error` is an English fallback for logs and curl.
 */
export function apiError(reply: FastifyReply, status: number, code: string, params?: Record<string, string | number>, extra?: Record<string, unknown>) {
  return reply.code(status).send({ error: t("en", code, params), code, params, ...extra });
}

/** Throwable variant (used from helpers that don't have the reply) */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    public params?: Record<string, string | number>,
  ) {
    super(t("en", code, params));
  }
}
