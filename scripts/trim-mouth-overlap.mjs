import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pruneFaces } from './prune-cave-shards.mjs';
import selection from './cave-mouth-overlap-selection.json' with { type: 'json' };

async function main() {
  if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node scripts/trim-mouth-overlap.mjs <original asset directory> <output directory>');
  for (const { file, sourceSha256, faces } of selection.assets) {
    const input = await readFile(resolve(process.argv[2], file));
    await writeFile(resolve(process.argv[3], file), pruneFaces(input, faces, sourceSha256));
    console.log(`${file}: removed ${faces.length} whole boundary triangles inside existing overlap`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
