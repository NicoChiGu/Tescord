import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// Turbo runs workspace scripts from apps/server, while the shared development
// environment file lives at the monorepo root. Resolve it from this module so
// startup behaves the same for `tsx`, the compiled server, and any caller cwd.
const rootEnvPath = fileURLToPath(new URL("../../../.env", import.meta.url));

config({ path: rootEnvPath });

// Keep a fresh clone usable for the SQLite-backed development server even
// before the optional root .env file has been copied from .env.example.
if (process.env.NODE_ENV !== "production") {
  process.env.DATABASE_URL ??= "file:./dev.db";
}
process.env.DATABASE_PROVIDER ??=
  process.env.NODE_ENV === "production" ? "postgresql" : "sqlite";

const insecureProductionDefaults = new Map([
  ["JWT_SECRET", "tescord_fallback_jwt_secret_dev_2026"],
  ["LIVEKIT_API_KEY", "devkey"],
  ["LIVEKIT_API_SECRET", "secretsecretsecret"],
  ["TURN_SECRET", "replace-with-long-random-turn-secret"],
  ["UPLOAD_SIGNING_SECRET", "replace-with-long-random-upload-secret"],
]);

if (process.env.NODE_ENV === "production") {
  const cloudflareMedia = process.env.VOICE_ENGINE === "cloudflare_realtime";
  const required = [
    "DATABASE_URL",
    "JWT_SECRET",
    ...(cloudflareMedia
      ? ["CLOUDFLARE_CALLS_APP_ID", "CLOUDFLARE_CALLS_APP_SECRET", "CLOUDFLARE_CALLS_TURN_KEY_ID", "CLOUDFLARE_CALLS_TURN_API_TOKEN"]
      : ["LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "LIVEKIT_URL", "LIVEKIT_HTTP_URL"]),
    "UPLOAD_SIGNING_SECRET",
    "MINIO_ACCESS_KEY",
    "MINIO_SECRET_KEY",
    "MINIO_ENDPOINT",
    "REDIS_URL",
    "CORS_ORIGINS",
    "SERVER_BASE_URL",
  ];
  const knownPlaceholders = new Set([
    ...insecureProductionDefaults.values(),
    "replace-with-random-secret",
    "replace-with-random-turn-secret",
    "replace-with-long-random-upload-secret",
    "minioadmin",
    "minioadminpassword",
    "tescord_secret_password",
    "devkey",
    "secretsecretsecret",
  ]);
  const invalid = required.filter((name) => {
    const value = process.env[name]?.trim();
    if (
      !value ||
      knownPlaceholders.has(value) ||
      /^(replace|changeme|example|devkey)/i.test(value)
    )
      return true;
    if (
      [
        "JWT_SECRET",
        "LIVEKIT_API_SECRET",
        "TURN_SECRET",
        "UPLOAD_SIGNING_SECRET",
        "MINIO_SECRET_KEY",
      ].includes(name)
    ) {
      return Buffer.byteLength(value, "utf8") < 32;
    }
    return false;
  });
  const turnHost = process.env.TURN_HOST?.trim() || "";
  const turnSecret = process.env.TURN_SECRET?.trim() || "";
  if (Boolean(turnHost) !== Boolean(turnSecret))
    invalid.push("TURN_HOST/TURN_SECRET");
  if (
    turnSecret &&
    (Buffer.byteLength(turnSecret, "utf8") < 32 ||
      knownPlaceholders.has(turnSecret))
  )
    invalid.push("TURN_SECRET");
  if (
    process.env.DATABASE_PROVIDER !== "postgresql" ||
    !/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL || "")
  )
    invalid.push("DATABASE_PROVIDER/DATABASE_URL");
  if (!/^https:\/\//.test(process.env.SERVER_BASE_URL || ""))
    invalid.push("SERVER_BASE_URL");
  try {
    const databaseUrl = new URL(process.env.DATABASE_URL || "");
    const password = decodeURIComponent(databaseUrl.password);
    if (
      Buffer.byteLength(password, "utf8") < 32 ||
      /^(replace|changeme|example)/i.test(password)
    )
      invalid.push("DATABASE_URL password");
    const redisUrl = new URL(process.env.REDIS_URL || "");
    const redisPassword = decodeURIComponent(redisUrl.password);
    if (
      !/^rediss?:$/.test(redisUrl.protocol) ||
      Buffer.byteLength(redisPassword, "utf8") < 32 ||
      /^(replace|changeme|example)/i.test(redisPassword)
    )
      invalid.push("REDIS_URL password");
  } catch {
    invalid.push("DATABASE_URL/REDIS_URL");
  }
  if (!cloudflareMedia && !/^wss:\/\//.test(process.env.LIVEKIT_URL || ""))
    invalid.push("LIVEKIT_URL");
  if (!cloudflareMedia && !/^https?:\/\//.test(process.env.LIVEKIT_HTTP_URL || ""))
    invalid.push("LIVEKIT_HTTP_URL");
  const allowedOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((item) => item.trim());
  if (allowedOrigins.some((origin) => !/^https:\/\/[^/]+$/.test(origin)))
    invalid.push("CORS_ORIGINS");
  if (/^(localhost|127\.0\.0\.1|::1)$/.test(process.env.TURN_HOST || ""))
    invalid.push("TURN_HOST");
  if (
    process.env.JWT_SECRET === process.env.UPLOAD_SIGNING_SECRET ||
    (turnSecret &&
      (process.env.JWT_SECRET === turnSecret ||
        process.env.UPLOAD_SIGNING_SECRET === turnSecret))
  )
    invalid.push("independent signing secrets");

  const cfAppId = process.env.CLOUDFLARE_CALLS_APP_ID?.trim() || "";
  const cfAppSecret = process.env.CLOUDFLARE_CALLS_APP_SECRET?.trim() || "";
  if (Boolean(cfAppId) !== Boolean(cfAppSecret)) {
    invalid.push("CLOUDFLARE_CALLS_APP_ID/CLOUDFLARE_CALLS_APP_SECRET pair");
  }

  const cfTurnKeyId = process.env.CLOUDFLARE_CALLS_TURN_KEY_ID?.trim() || "";
  const cfTurnToken = process.env.CLOUDFLARE_CALLS_TURN_API_TOKEN?.trim() || "";
  if (Boolean(cfTurnKeyId) !== Boolean(cfTurnToken)) {
    invalid.push("CLOUDFLARE_CALLS_TURN_KEY_ID/CLOUDFLARE_CALLS_TURN_API_TOKEN pair");
  }

  if (invalid.length > 0) {
    throw new Error(
      `Production secrets are missing or still use development defaults: ${invalid.join(", ")}`,
    );
  }
}
