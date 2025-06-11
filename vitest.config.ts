import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
    test: {
        globals: true,
        include: ["src/**/*.{test,spec}.{js,ts}"],
        exclude: ["**/node_modules/**", "**/dist/**", "**/coverage/**"],
        poolOptions: {
            workers: {
                wrangler: {
                    configPath: "./wrangler.jsonc",
                },
                main: "./src/index.ts",
                isolatedStorage: false,
            },
        },
    },
});
