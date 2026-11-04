// Builds the game, then inlines the JS and CSS into one standalone HTML file:
// dist/CallToArms.html (open it directly in a browser, no server needed).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
let html = readFileSync(join(dist, 'index.html'), 'utf8');
const assets = readdirSync(join(dist, 'assets'));
for (const f of assets) {
  const code = readFileSync(join(dist, 'assets', f), 'utf8');
  if (f.endsWith('.js')) {
    const re = new RegExp(`<script[^>]*src="[^"]*${f.replace('.', '\\.')}"[^>]*></script>`);
    const safe = code.replace(/<\/script/gi, '<\\/script');
    html = html.replace(re, () => '');
    html = html.replace('</body>', () => `<script type="module">\n${safe}\n</script>\n</body>`);
  } else if (f.endsWith('.css')) {
    const re = new RegExp(`<link[^>]*href="[^"]*${f.replace('.', '\\.')}"[^>]*>`);
    html = html.replace(re, () => `<style>\n${code}\n</style>`);
  }
}
writeFileSync(join(dist, 'CallToArms.html'), html);
console.log(`dist/CallToArms.html  ${(html.length / 1024).toFixed(0)} KB`);
