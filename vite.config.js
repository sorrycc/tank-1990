import { defineConfig } from 'vite'

// Relative base so the production build runs from any sub-path or a file:// preview
// (F0 scaffold §4 Decision 1, AC11 — offline / file:// constraint). Mirrors the
// read-only `dead-cell` reference config.
export default defineConfig({
  base: './',
  server: { open: true },
})
