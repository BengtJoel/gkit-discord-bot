import pino from "pino";
import { env } from "../env.js";

export const log = pino({
  level: env.LOG_LEVEL,
  transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
});
