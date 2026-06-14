import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/style.css"],
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "@xterm/xterm",
    "@xterm/addon-fit",
  ],
  loader: {
    ".css": "copy",
  },
});
