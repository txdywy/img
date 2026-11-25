// A tiny static server for docs/, shared by the browser tests.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname, extname, join, normalize} from 'node:path';
import {fileURLToPath} from 'node:url';

export const docs = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg'};

export async function serve() {
  const server = createServer(async (request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    try {
      const body = await readFile(join(docs, path.endsWith('/') ? path + 'index.html' : path));
      response.writeHead(200, {'content-type': types[extname(path)] || 'text/html; charset=utf-8'});
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close()};
}
