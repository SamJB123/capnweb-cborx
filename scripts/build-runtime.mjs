import { build } from "tsup";

await build({
  entry: ["src/index.ts", "src/index-workers.ts"],
  format: ["esm", "cjs"],
  external: ["cloudflare:workers"],
  dts: false,
  sourcemap: true,
  clean: true,
  target: "es2023",
  platform: "neutral",
  splitting: false,
  treeshake: true,
  minify: false,
});
