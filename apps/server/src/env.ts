import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// Turbo runs workspace scripts from apps/server, while the shared development
// environment file lives at the monorepo root. Resolve it from this module so
// startup behaves the same for `tsx`, the compiled server, and any caller cwd.
const rootEnvPath = fileURLToPath(new URL("../../../.env", import.meta.url));

config({ path: rootEnvPath });

// Keep a fresh clone usable for the SQLite-backed development server even
// before the optional root .env file has been copied from .env.example.
process.env.DATABASE_URL ??= "file:./dev.db";

const insecureProductionDefaults = new Map([
  ["JWT_SECRET", "tescord_fallback_jwt_secret_dev_2026"],
  ["LIVEKIT_API_KEY", "devkey"],
  ["LIVEKIT_API_SECRET", "secretsecretsecret"],
  ["TURN_SECRET", "replace-with-long-random-turn-secret"],
  ["UPLOAD_SIGNING_SECRET", "replace-with-long-random-upload-secret"],
]);

if (process.env.NODE_ENV === "production") {
  const invalid = Array.from(insecureProductionDefaults.entries())
    .filter(([name, fallback]) => !process.env[name] || process.env[name] === fallback)
    .map(([name]) => name);
  if (invalid.length > 0) {
    throw new Error(
      `Production secrets are missing or still use development defaults: ${invalid.join(", ")}`,
    );
  }
}
