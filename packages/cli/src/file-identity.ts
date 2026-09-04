import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";

interface FileIdentity {
  readonly device: bigint;
  readonly inode: bigint;
  readonly realPath: string;
}

export async function pathsReferToSameFile(
  left: string,
  right: string,
): Promise<boolean> {
  if (pathComparisonKey(left) === pathComparisonKey(right)) return true;
  const [leftIdentity, rightIdentity] = await Promise.all([
    existingFileIdentity(left),
    existingFileIdentity(right),
  ]);
  if (leftIdentity === null || rightIdentity === null) return false;
  return (
    (leftIdentity.inode !== 0n &&
      leftIdentity.device === rightIdentity.device &&
      leftIdentity.inode === rightIdentity.inode) ||
    pathComparisonKey(leftIdentity.realPath) ===
      pathComparisonKey(rightIdentity.realPath)
  );
}

async function existingFileIdentity(
  path: string,
): Promise<FileIdentity | null> {
  try {
    const [metadata, realPath] = await Promise.all([
      stat(path, { bigint: true }),
      realpath(path),
    ]);
    return {
      device: metadata.dev,
      inode: metadata.ino,
      realPath,
    };
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}

function pathComparisonKey(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
