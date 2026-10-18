import { configDefaults, defineConfig } from "vitest/config";
import { tierPattern, tiers } from "./test/tiers.ts";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["service/src/**/*.ts", "scripts/**/*.ts"],
      // Vitest leaves out only *.test.ts by itself.
      exclude: [...tiers.map(tierPattern), "**/vitest.config.ts"],
      reporter: ["text"],
    },
    projects: tiers.map((tier) => ({
      test: {
        name: tier.name,
        include: [tierPattern(tier)],
        exclude: [...configDefaults.exclude, "**/dist/**"],
        setupFiles: ["test/offline.ts", "test/quiet-log.ts"],
        testTimeout: tier.name === "int" ? 30_000 : 5_000,
      },
    })),
  },
});
