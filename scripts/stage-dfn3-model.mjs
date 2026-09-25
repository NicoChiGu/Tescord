import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Zip = require("adm-zip");
const root = path.resolve("apps/web/public/models/dfn3");
const expected = {
  "denoiser_model.onnx": "b758c49d6708a5b7979e3de185705a8a4915076c862fb17b1b304d9a72b75cdc",
  "initial_states.npz": "1165503707b8859a6b650b6bb0dc5b6c55d30c2779d87502f97a77102b5d3872",
  "meta.json": "e3a8fefd13c43747b97471bf889d54608465198a58c2b99006483b1b4bad2962",
};
for (const [name, want] of Object.entries(expected)) {
  const got = createHash("sha256").update(fs.readFileSync(path.join(root, name))).digest("hex");
  if (got !== want) throw new Error(`${name}: SHA-256 mismatch: ${got}`);
}
const meta = JSON.parse(fs.readFileSync(path.join(root, "meta.json"), "utf8"));
const zip = new Zip(path.join(root, "initial_states.npz"));
const buffers = [];
const layout = {};
let offset = 0;
for (const name of meta.input_names.slice(1)) {
  const entry = zip.getEntry(`${name}.npy`);
  if (!entry) throw new Error(`Missing state ${name}`);
  const bytes = entry.getData();
  if (bytes.subarray(0, 6).toString("binary") !== "\x93NUMPY") throw new Error(`Invalid NPY ${name}`);
  const major = bytes[6];
  const headerLength = major === 1 ? bytes.readUInt16LE(8) : bytes.readUInt32LE(8);
  const headerOffset = major === 1 ? 10 : 12;
  const header = bytes.subarray(headerOffset, headerOffset + headerLength).toString("ascii");
  if (!/['"]descr['"]:\s*['"]<f4['"]/.test(header) || !/['"]fortran_order['"]:\s*False/.test(header))
    throw new Error(`Unsupported NPY format ${name}: ${header}`);
  const match = header.match(/['"]shape['"]:\s*\(([^)]*)\)/);
  if (!match) throw new Error(`Missing NPY shape ${name}`);
  const dims = match[1].split(",").map((v) => Number(v.trim())).filter((v) => Number.isInteger(v) && v > 0);
  const data = bytes.subarray(headerOffset + headerLength);
  if (data.length !== dims.reduce((a, b) => a * b, 1) * 4) throw new Error(`State length mismatch ${name}`);
  layout[name] = { shape: dims, byteOffset: offset, byteLength: data.length };
  buffers.push(data);
  offset += data.length;
}
fs.writeFileSync(path.join(root, "initial-state-layout.json"), JSON.stringify(layout, null, 2) + "\n");
fs.writeFileSync(path.join(root, "initial-states.f32"), Buffer.concat(buffers));
console.log(`Staged ${Object.keys(layout).length} DFN3 states (${offset} bytes)`);
