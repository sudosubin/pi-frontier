import path from "node:path";

function untildify(filePath: string): string {
  const home = process.env["HOME"] || "";
  if (filePath === "~") return home;
  if (filePath.startsWith("~/")) return path.join(home, filePath.slice(2));
  return filePath;
}

export function resolvePath(filePath: string, basePath?: string): string {
  const untildified = untildify(filePath);
  if (basePath && !path.isAbsolute(untildified)) {
    return path.resolve(basePath, untildified);
  }
  return path.resolve(untildified);
}
