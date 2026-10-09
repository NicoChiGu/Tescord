import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";

const webRequire = createRequire(resolve("apps/web/package.json"));
const tailwindRequire = createRequire(webRequire.resolve("tailwindcss"));
const consumers = [
  ["chokidar", createRequire(tailwindRequire.resolve("chokidar"))],
  ["micromatch", createRequire(tailwindRequire.resolve("micromatch"))],
  [
    "fast-glob/micromatch",
    createRequire(
      createRequire(tailwindRequire.resolve("fast-glob")).resolve("micromatch"),
    ),
  ],
];
const braces = consumers[0][1]("braces");
const isDepthError = (error) =>
  error instanceof SyntaxError && /depth/.test(error.message);
const deep = (open, close, count = 4000) =>
  open.repeat(count) + "x" + close.repeat(count);

for (const [name, require] of consumers) {
  test(`braces depth guard is active through ${name}`, () => {
    assert.throws(() => require("braces")(deep("{", "}")), isDepthError);
  });
}
for (const method of ["parse", "compile", "expand", "stringify"]) {
  test(`braces ${method} rejects deep brace and parentheses strings`, () => {
    for (const input of [
      deep("{", "}"),
      deep("(", ")"),
      "{".repeat(8000) + "x",
      "{".repeat(60) + deep("(", ")", 60) + "}".repeat(60),
    ]) {
      assert.ok(input.length < 10000);
      assert.throws(() => braces[method](input), isDepthError);
    }
  });
}
for (const method of ["compile", "expand", "stringify"]) {
  test(`braces ${method} rejects directly supplied deep and cyclic ASTs`, () => {
    let ast = { type: "text", value: "x" };
    for (let index = 0; index < 4000; index++) {
      ast = { type: "root", nodes: [ast] };
    }
    assert.throws(() => braces[method](ast), isDepthError);
    const cyclic = { type: "root", nodes: [] };
    cyclic.nodes.push(cyclic);
    assert.throws(() => braces[method](cyclic), /cyclic nodes/);
  });
}
test("braces preserves trusted expansion and compilation", () => {
  assert.deepEqual(braces.expand("src/{a,b}/{1..3}.ts"), [
    "src/a/1.ts",
    "src/a/2.ts",
    "src/a/3.ts",
    "src/b/1.ts",
    "src/b/2.ts",
    "src/b/3.ts",
  ]);
  assert.equal(braces.compile("src/{a,b}.ts"), "src/(a|b).ts");
  assert.equal(braces.stringify(braces.parse("src/{a,b}.ts")), "src/{a,b}.ts");
  assert.doesNotThrow(() => braces.compile(deep("{", "}", 50)));
  assert.doesNotThrow(() => braces.expand(deep("{", "}", 50)));
});
test("braces does not mistake quoted, escaped or bracket literals for nesting", () => {
  const pattern = deep("{", "}");
  assert.equal(braces.compile(`"${pattern}"`), pattern);
  assert.equal(braces.compile(`[${pattern}]`), `[${pattern}]`);
  const escaped = deep("\\{", "\\}", 2000);
  assert.equal(braces.compile(escaped, { keepEscaping: true }), escaped);
});
test("micromatch consumer retains glob behavior and rejects deep expansion", () => {
  const micromatch = tailwindRequire("micromatch");
  assert.deepEqual(
    micromatch(["src/a.ts", "src/b.tsx", "src/c.css"], "src/*.{ts,tsx}"),
    ["src/a.ts", "src/b.tsx"],
  );
  assert.throws(() => micromatch.braceExpand(deep("{", "}")), isDepthError);
});

const desktopRequire = createRequire(resolve("apps/desktop/package.json"));
const packagerRequire = createRequire(
  desktopRequire.resolve("electron-builder"),
);
const builderRequire = createRequire(
  packagerRequire.resolve("app-builder-lib"),
);
const electronGetRequire = createRequire(
  builderRequire.resolve("@electron/get"),
);
const onnxRequire = createRequire(desktopRequire.resolve("onnxruntime-node"));
for (const [name, require] of [
  ["@electron/get", electronGetRequire],
  ["onnxruntime-node", onnxRequire],
]) {
  test(`${name} uses the updated global-agent without sprintf-js`, () => {
    const metadata = require("global-agent/package.json");
    assert.equal(metadata.version, "4.1.3");
    assert.equal(metadata.dependencies.roarr, undefined);
    assert.equal(metadata.dependencies["sprintf-js"], undefined);
    const agent = require("global-agent");
    assert.equal(typeof agent.bootstrap, "function");
    assert.equal(typeof agent.createGlobalProxyAgent, "function");
  });
}
