import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    name: "workerd",
    include: [
      "__tests__/workerd.test.ts",
    ],
    pool: "@cloudflare/vitest-pool-workers",
    poolOptions: {
      workers: {
        miniflare: {
          compatibilityDate: "2025-07-01",
          compatibilityFlags: ["expose_global_message_channel", "nodejs_compat"],
          serviceBindings: {
            testServer: "test-server-workerd",
          },
          workers: [
            {
              name: "test-server-workerd",
              compatibilityDate: "2025-07-01",
              compatibilityFlags: ["nodejs_compat"],
              modules: [
                {
                  type: "ESModule",
                  path: resolve(__dirname, "__tests__/test-server-workerd.js"),
                },
                {
                  type: "ESModule",
                  path: resolve(__dirname, "dist/index-workers.js"),
                },
              ],
              durableObjects: {
                TEST_DO: "TestDo",
                HIB_RPC: "HibernationRpcDo",
              },
            },
          ],
        },
      },
    },
  },
});
