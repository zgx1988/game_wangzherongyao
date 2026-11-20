import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

await esbuild.build({
  entryPoints: [path.join(root, 'server', 'lan-server.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: path.join(root, 'server', 'dist-server.mjs'),
  external: ['ws'],
  banner: {
    js: '// Bundled Honor of Glory 5v5 LAN Server\n',
  },
});

console.log('Built server/dist-server.mjs successfully.');
