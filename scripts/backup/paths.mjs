import path from "node:path";
import { realpath } from "node:fs/promises";

function comparisonPath(value) {
  const absolute = path.resolve(value);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

function within(candidate, directory) {
  const target = comparisonPath(candidate);
  const root = comparisonPath(directory);
  return target === root || target.startsWith(root + path.sep);
}

async function resolveFuturePath(value) {
  const suffix = [];
  let current = path.resolve(value);
  for (;;) {
    try {
      return path.join(await realpath(current), ...suffix.reverse());
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current)
        throw new Error("backup_destination_unresolvable");
      suffix.push(path.basename(current));
      current = parent;
    }
  }
}

/** Resolve existing ancestors before checking boundaries, including junctions. */
export async function resolveOutsideRepository(destination, repositoryRoot) {
  if (typeof destination !== "string" || !path.isAbsolute(destination)) {
    throw new Error("backup_destination_absolute_required");
  }
  const repository = await realpath(repositoryRoot);
  const resolved = await resolveFuturePath(destination);
  if (within(destination, repositoryRoot) || within(resolved, repository)) {
    throw new Error("backup_destination_in_repository");
  }
  return resolved;
}
