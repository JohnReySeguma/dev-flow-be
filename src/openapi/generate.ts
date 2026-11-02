/**
 * Writes docs/openapi.json, the file the frontend generates its types from.
 * `--check` exits with 1 instead when the committed file is stale.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildOpenApiDocument, serializeOpenApi } from "./document.js";

export const OPENAPI_PATH = new URL("../../docs/openapi.json", import.meta.url);

const next = serializeOpenApi(buildOpenApiDocument());

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OPENAPI_PATH, "utf8");
  } catch {
    // Missing counts as stale.
  }
  if (current !== next) {
    console.error("docs/openapi.json is stale. Run `npm run openapi:generate` and commit the result.");
    process.exit(1);
  }
  console.log("docs/openapi.json is up to date.");
} else {
  writeFileSync(OPENAPI_PATH, next);
  console.log("wrote docs/openapi.json");
}
