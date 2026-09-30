import { readFileSync } from "node:fs";

interface PackageJson {
  version: string;
}

export const packageVersion = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as PackageJson
).version;
