import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

const browserConfig = {
  bundle: true,
  minify: !isWatch,
  sourcemap: isWatch,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  logLevel: 'info',
};

const builds = [
  // Service worker — must be a classic script (not ES module) for MV3 compatibility
  { ...browserConfig, entryPoints: ['src/service-worker.ts'], outfile: 'dist/service-worker.js' },
  // Side panel UI
  { ...browserConfig, entryPoints: ['src/panel.ts'], outfile: 'dist/panel.js' },
  // Content script
  { ...browserConfig, entryPoints: ['src/content.ts'], outfile: 'dist/content.js' },
];

if (isWatch) {
  const ctxs = await Promise.all(builds.map(b => esbuild.context(b)));
  await Promise.all(ctxs.map(c => c.watch()));
  console.log('Watching for changes...');
} else {
  await Promise.all(builds.map(b => esbuild.build(b)));
}
