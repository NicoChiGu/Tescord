import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import net from "node:net";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const desktopRequire = createRequire(resolve("apps/desktop/package.json"));
const packagerRequire = createRequire(
  desktopRequire.resolve("electron-builder"),
);
const builderRequire = createRequire(
  packagerRequire.resolve("app-builder-lib"),
);
const electronGetEntry = builderRequire.resolve("@electron/get");
const onnxEntry = desktopRequire.resolve("onnxruntime-node");
const certificatePath = resolve(
  "apps/web/node_modules/.vite/basic-ssl/_cert.pem",
);
const run = promisify(execFile);

for (const [name, entry] of [
  ["@electron/get", electronGetEntry],
  ["onnxruntime-node", onnxEntry],
]) {
  test(`${name} proxy initialization preserves HTTP, HTTPS CONNECT and NO_PROXY`, async () => {
    const certificate = await readFile(certificatePath);
    const origin = http.createServer((_, response) =>
      response.end("http-origin"),
    );
    const secureOrigin = https.createServer(
      { key: certificate, cert: certificate },
      (_, response) => response.end("https-origin"),
    );
    let forwarded = 0;
    let tunnels = 0;
    const sockets = new Set();
    const proxy = http.createServer((request, response) => {
      forwarded++;
      const target = new URL(request.url);
      assert.equal(target.hostname, "127.0.0.1");
      assert.equal(Number(target.port), origin.address().port);
      const outgoing = http.request(target, (incoming) =>
        incoming.pipe(response),
      );
      outgoing.on("error", () => response.destroy());
      request.pipe(outgoing);
    });
    proxy.on("connect", (request, socket, head) => {
      tunnels++;
      assert.equal(request.url, `127.0.0.1:${secureOrigin.address().port}`);
      const upstream = net.connect(
        secureOrigin.address().port,
        "127.0.0.1",
        () => {
          socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length) upstream.write(head);
          upstream.pipe(socket);
          socket.pipe(upstream);
        },
      );
      sockets.add(upstream);
      upstream.on("close", () => sockets.delete(upstream));
      upstream.on("error", () => socket.destroy());
      socket.on("error", () => upstream.destroy());
    });
    for (const server of [origin, secureOrigin, proxy]) {
      server.on("connection", (socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
      });
    }
    try {
      for (const server of [origin, secureOrigin, proxy]) {
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      }
      const env = {
        ...process.env,
        GLOBAL_AGENT_HTTP_PROXY: `http://127.0.0.1:${proxy.address().port}`,
        GLOBAL_AGENT_HTTPS_PROXY: `http://127.0.0.1:${proxy.address().port}`,
        GLOBAL_AGENT_NO_PROXY: "localhost",
        GLOBAL_AGENT_ENVIRONMENT_VARIABLE_NAMESPACE: "GLOBAL_AGENT_",
        GLOBAL_AGENT_FORCE_GLOBAL_AGENT: "true",
        NODE_EXTRA_CA_CERTS: certificatePath,
      };
      delete env.NODE_TLS_REJECT_UNAUTHORIZED;
      const code = String.raw`
        const assert = require('node:assert/strict');
        const { createRequire } = require('node:module');
        const http = require('node:http');
        const https = require('node:https');
        const [name, entry, plainPort, securePort] = process.argv.slice(1);
        const dependencyRequire = createRequire(entry);
        if (name === '@electron/get') {
          dependencyRequire('./proxy.js').initializeProxy();
        } else {
          assert.equal(dependencyRequire('global-agent').bootstrap(), true);
        }
        assert.ok(globalThis.GLOBAL_AGENT);
        const fetch = (transport, url) => new Promise((resolve, reject) => {
          const request = transport.get(url, { family: 4 }, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => body += chunk);
            response.on('end', () => resolve(body));
          });
          request.setTimeout(5000, () => request.destroy(new Error('request timed out')));
          request.on('error', reject);
        });
        (async () => {
          assert.equal(await fetch(http, 'http://127.0.0.1:' + plainPort + '/'), 'http-origin');
          assert.equal(await fetch(https, 'https://127.0.0.1:' + securePort + '/'), 'https-origin');
          assert.equal(await fetch(http, 'http://localhost:' + plainPort + '/'), 'http-origin');
          process.stdout.write('proxy-compatible');
        })().catch(error => { console.error(error); process.exitCode = 1; });
      `;
      const result = await run(
        process.execPath,
        [
          "-e",
          code,
          name,
          entry,
          String(origin.address().port),
          String(secureOrigin.address().port),
        ],
        { env, timeout: 15000, windowsHide: true },
      );
      assert.equal(result.stdout, "proxy-compatible");
      assert.equal(forwarded, 1, "localhost must bypass the proxy");
      assert.equal(
        tunnels,
        1,
        "HTTPS must use CONNECT with certificate verification",
      );
    } finally {
      for (const socket of sockets) socket.destroy();
      await Promise.all(
        [origin, secureOrigin, proxy].map(
          (server) => new Promise((resolve) => server.close(resolve)),
        ),
      );
    }
  });
}
