import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const keyDir = path.join(root, "release-keys");
mkdirSync(keyDir, { recursive: true });
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privatePath = path.join(keyDir, "update-private-key.base64");
const publicPath = path.join(keyDir, "update-public-key.base64");
writeFileSync(privatePath, privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"), { flag: "wx", mode: 0o600 });
writeFileSync(publicPath, publicKey.export({ format: "der", type: "spki" }).toString("base64"), { flag: "wx" });
console.log(`Update signing key pair written to ${keyDir}; store the private key outside the repository and in GitHub Actions secrets.`);
