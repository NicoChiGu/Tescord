import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

import "../src/env.js";

const require = createRequire(import.meta.url);
const prismaCli = require.resolve("prisma");
const provider = process.env.DATABASE_PROVIDER;
if (provider !== "sqlite" && provider !== "postgresql") {
  throw new Error("DATABASE_PROVIDER must be sqlite or postgresql");
}
const url = process.env.DATABASE_URL || "";
if (
  (provider === "sqlite" && !url.startsWith("file:")) ||
  (provider === "postgresql" && !/^postgres(ql)?:\/\//.test(url))
) {
  throw new Error("DATABASE_URL does not match DATABASE_PROVIDER");
}
const args = process.argv.slice(2);
if (args.includes("--schema"))
  throw new Error("Schema is selected by DATABASE_PROVIDER");
if (
  (process.env.NODE_ENV === "production" || provider === "postgresql") &&
  (args.join(" ").startsWith("db push") ||
    args.join(" ").startsWith("migrate reset") ||
    args.join(" ").startsWith("migrate dev"))
) {
  throw new Error(
    "Development database commands are forbidden for PostgreSQL or production",
  );
}
const schema =
  provider === "postgresql"
    ? "prisma-postgres/schema.prisma"
    : "prisma/schema.prisma";
const result = spawnSync(
  process.execPath,
  [prismaCli, ...args, "--schema", schema],
  {
    cwd: new URL("..", import.meta.url),
    env: process.env,
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
