// Builds the game, then inlines the JS and CSS into one standalone HTML file:
// dist/CallToArms.html (open it directly in a browser, no server needed).
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
let html = readFileSync(join(dist, 'index.html'), 'utf8');
const assets = readdirSync(join(dist, 'assets'));
for (const f of assets) {
  if (!f.endsWith('.js') && !f.endsWith('.css')) continue;
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
// Embed the glTF assets (copied from public/assets into dist/assets) as data URIs.
const embedded = {};
const walk = (dir, rel) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f), r = rel ? `${rel}/${f}` : f;
    if (statSync(p).isDirectory()) walk(p, r);
    else if (f.endsWith('.glb')) embedded[`assets/${r}`] = `data:model/gltf-binary;base64,${readFileSync(p).toString('base64')}`;
    else if (f.endsWith('.mp3')) embedded[`assets/${r}`] = `data:audio/mpeg;base64,${readFileSync(p).toString('base64')}`;
    else if (f.endsWith('.webp')) embedded[`assets/${r}`] = `data:image/webp;base64,${readFileSync(p).toString('base64')}`;
    else if (f.endsWith('.jpg')) embedded[`assets/${r}`] = `data:image/jpeg;base64,${readFileSync(p).toString('base64')}`;
    else if (f.endsWith('.hdr')) embedded[`assets/${r}`] = `data:application/octet-stream;base64,${readFileSync(p).toString('base64')}`;
    else if (f.endsWith('.json')) embedded[`assets/${r}`] = `data:application/json;base64,${readFileSync(p).toString('base64')}`;
  }
};
if (existsSync('public/assets')) walk('public/assets', '');
const assetScript = `<script>window.__CTA_ASSETS=${JSON.stringify(embedded)};</script>`;
html = html.replace('<script type="module">', () => `${assetScript}\n<script type="module">`);
console.log(`embedded ${Object.keys(embedded).length} asset files`);
writeFileSync(join(dist, 'CallToArms.html'), html);
console.log(`dist/CallToArms.html  ${(html.length / 1024).toFixed(0)} KB`);
