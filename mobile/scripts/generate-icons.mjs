import { readFile, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

const assets = new URL('../assets/', import.meta.url);
const render = async (source, target, size) => {
  const svg = await readFile(new URL(`source/${source}.svg`, assets));
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  await writeFile(new URL(`${target}.png`, assets), png);
};

await render('icon', 'icon', 1024);
await render('icon', 'splash-icon', 512);
await render('icon', 'favicon', 64);
await render('foreground', 'android-icon-foreground', 432);
await render('background', 'android-icon-background', 432);
await render('monochrome', 'android-icon-monochrome', 432);
