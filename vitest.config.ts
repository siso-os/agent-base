export default {
  esbuild: { jsx: "automatic" },
  test: {
    pool: "threads",
    include: ["apps/web/src/lib/__tests__/**/*.test.ts", "apps/web/src/lib/checkpoint.test.ts", "services/node/src/__tests__/**/*.test.ts"],
    globals: true,
  },
};
