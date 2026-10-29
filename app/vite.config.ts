import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// `vite build` makes the app the local server and static hosts serve (relative paths, so any folder works).
// `vite build --mode single` makes one self-contained openchurn.html that works when double-clicked.
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [react(), ...(mode === "single" ? [viteSingleFile()] : [])],
  build: mode === "single" ? { outDir: "dist-single", assetsInlineLimit: 100_000_000 } : { outDir: "dist" },
}));
