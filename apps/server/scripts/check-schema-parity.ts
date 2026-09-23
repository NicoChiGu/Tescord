import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sqlitePath = fileURLToPath(
  new URL("../prisma/schema.prisma", import.meta.url),
);
const postgresPath = fileURLToPath(
  new URL("../prisma-postgres/schema.prisma", import.meta.url),
);
const sqlite = readFileSync(sqlitePath, "utf8").replace(/\r\n/g, "\n");
const postgres = readFileSync(postgresPath, "utf8").replace(/\r\n/g, "\n");
const expected = sqlite.replace(
  'provider = "sqlite"',
  'provider = "postgresql"',
);

if (expected === sqlite || expected !== postgres) {
  console.error(
    "SQLite and PostgreSQL Prisma schemas must differ only by datasource provider",
  );
  process.exit(1);
}
console.log("Prisma schema model parity: PASS");
