import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://guildbot:guildbot@localhost:5432/guildbot_test",
      SESSION_SECRET: "test_test_test_test_test_test_test_test",
      BOT_ENABLED: "false",
      LOG_LEVEL: "silent",
      NODE_ENV: "test",
    },
    // DB tests share one database
    fileParallelism: false,
  },
});
