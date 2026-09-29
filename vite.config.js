import { defineConfig } from 'vite';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const cachedFiles = new Set(['/osm-cache.json', '/listings.json', '/elevation.json']);

export default defineConfig({
  plugins: [{
    name: 'serve-osm-cache',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!cachedFiles.has(req.url)) return next();
        const file = path.resolve('data', req.url.slice(1));
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        fs.createReadStream(file).on('error', next).pipe(res);
      });
    },
    async writeBundle(options) {
      const out = options.dir || path.resolve('dist');
      await Promise.all([...cachedFiles].map(file => fsp.copyFile(path.resolve('data', file.slice(1)), path.join(out, file.slice(1)))));
    }
  }],
  server: { host: '0.0.0.0', port: 3002 },
  preview: { host: '0.0.0.0', port: 3002 },
  build: { chunkSizeWarningLimit: 650 }
});
