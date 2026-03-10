// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: {
    target: 'es2022',
  },
  test: {
    globalSetup: ['__tests__/test-server.ts'],
    projects: [
      {
        test: {
          name: 'node',
          include: ['__tests__/index.test.ts', '__tests__/flow-control.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'workerd',
          include: ['__tests__/index.test.ts', '__tests__/workerd.test.ts'],
          pool: '@cloudflare/vitest-pool-workers',
          poolOptions: {
            workers: {
              miniflare: {
                compatibilityDate: '2026-02-05',
                serviceBindings: {
                  testServer: "test-server-workerd",
                },
                workers: [
                  {
                    name: "test-server-workerd",
                    compatibilityDate: '2026-02-05',
                    modules: [
                      {
                        type: "ESModule",
                        path: "./__tests__/test-server-workerd.js",
                      },
                      {
                        type: "ESModule",
                        path: "./dist/index-workers.js",
                      },
                    ],
                    durableObjects: {
                      TEST_DO: "TestDo"
                    }
                  }
                ]
              },
            },
          },
        },
      },
      {
        test: {
          name: 'browsers-with-using',
          include: ['__tests__/index.test.ts'],
          browser: {
            enabled: true,
            provider: 'playwright',
            instances: [
              { browser: 'chromium' },
            ],
            headless: true,
            screenshotFailures: false,
          },
        },
      },
      {
        esbuild: {
          target: 'es2022',
        },
        test: {
          name: 'browsers-without-using',
          include: ['__tests__/index.test.ts'],
          browser: {
            enabled: true,
            provider: 'playwright',
            instances: [
              { browser: 'chromium' },
              { browser: 'firefox' },
              { browser: 'webkit' },
            ],
            headless: true,
            screenshotFailures: false,
          },
        },
      },
    ],
  },
})
