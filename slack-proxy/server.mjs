import { createServer } from 'node:http';

import {
  getForwardHeaders,
  normalizeSlackStatus,
  resolveUpstreamUrl,
} from './lib.mjs';

const PORT = Number.parseInt(process.env.PORT ?? '8080', 10);
const TWENTY_INTERNAL_URL =
  process.env.TWENTY_INTERNAL_URL ?? 'http://server:3000';

const readRequestBody = async (request) => {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks);
};

const sendJson = (response, statusCode, payload) => {
  const body = JSON.stringify(payload);

  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body).toString(),
  });
  response.end(body);
};

const proxySlackRequest = async (request, response, pathname) => {
  const upstreamUrl = resolveUpstreamUrl({
    baseUrl: TWENTY_INTERNAL_URL,
    pathname,
  });

  if (!upstreamUrl) {
    sendJson(response, 404, { ok: false, message: 'Unsupported Slack route' });

    return;
  }

  const body = await readRequestBody(request);

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      headers: getForwardHeaders(request.headers),
      body: body.length > 0 ? body : undefined,
    });
    const upstreamBody = Buffer.from(await upstreamResponse.arrayBuffer());
    const contentType =
      upstreamResponse.headers.get('content-type') ??
      'application/json; charset=utf-8';

    response.writeHead(normalizeSlackStatus(upstreamResponse.status), {
      'content-type': contentType,
      'content-length': upstreamBody.byteLength.toString(),
    });
    response.end(upstreamBody);
  } catch (error) {
    sendJson(response, 502, {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : 'Failed to proxy Slack request to Twenty',
    });
  }
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const { pathname } = url;

  if (request.method === 'GET' && pathname === '/healthz') {
    sendJson(response, 200, {
      ok: true,
      target: TWENTY_INTERNAL_URL,
    });

    return;
  }

  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, message: 'Method not allowed' });

    return;
  }

  await proxySlackRequest(request, response, pathname);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `Slack proxy listening on port ${PORT} and forwarding to ${TWENTY_INTERNAL_URL}`,
  );
});
