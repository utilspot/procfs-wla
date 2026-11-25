// Deletes generated folders. Uses only Node built-ins, so it works without node_modules.
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);

for (const name of ["build", "dist", "node_modules"]) {
  await rm(fileURLToPath(new URL(name, root)), {
    recursive: true,
    force: true,
    maxRetries: 3,
  });
  console.log(`removed ${name}`);
}
