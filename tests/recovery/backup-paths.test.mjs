import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { resolveOutsideRepository } from "../../scripts/backup/paths.mjs";

test("backup path rejects repository itself, descendants, case aliases and symlinks into it", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "folio-path-guard-"));
  const repo = path.join(parent, "Repository");
  const outside = path.join(parent, "private-backups");
  const alias = path.join(parent, "repo-link");
  try {
    await mkdir(repo);
    await mkdir(outside);
    await symlink(
      repo,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(
      resolveOutsideRepository(repo, repo),
      /backup_destination_in_repository/,
    );
    await assert.rejects(
      resolveOutsideRepository(path.join(repo, "new"), repo),
      /backup_destination_in_repository/,
    );
    await assert.rejects(
      resolveOutsideRepository(path.join(alias, "new"), repo),
      /backup_destination_in_repository/,
    );
    if (process.platform === "win32") {
      await assert.rejects(
        resolveOutsideRepository(repo.toUpperCase(), repo),
        /backup_destination_in_repository/,
      );
    }
    assert.equal(
      await resolveOutsideRepository(path.join(outside, "new"), repo),
      path.join(outside, "new"),
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
