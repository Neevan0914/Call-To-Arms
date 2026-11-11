import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

// Build stamp shown on the title screen, so it's easy to tell which version is open.
let hash = 'dev';
try { hash = execSync('git rev-parse --short HEAD').toString().trim(); } catch (e) { /* not a git checkout */ }
const stamp = `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${hash}`;

export default defineConfig({
  base: './',
  server: { host: true },
  build: { target: 'es2020', chunkSizeWarningLimit: 2000 },
  define: { __BUILD__: JSON.stringify(stamp) },
});
