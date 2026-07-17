#!/usr/bin/env node
/**
 * Compute the next version from conventional commits, update package.json,
 * create and push the git tag. The version is not committed — tags
 * (`toolweave@<version>`) are the source of truth.
 *
 * Usage: jiti scripts/bump-and-tag.ts
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '../..');
const TAG_PREFIX = 'toolweave@';
const RELEVANT_PATHS = ['src/', 'package.json', 'vite.config.ts'];

type BumpType = 'major' | 'minor' | 'patch' | 'none';

const BUMP_PRIORITY: Record<BumpType, number> = {
  major: 3,
  minor: 2,
  patch: 1,
  none: 0,
};

function parseConventionalCommit(message: string): BumpType {
  const firstLine = message.split('\n')[0] ?? '';
  const hasBreakingInBody =
    /BREAKING CHANGE:/i.test(message) || /^breaking change:/im.test(message);
  const hasExclamation = /^[a-z]+(\([^)]+\))?!:/.test(firstLine);

  if (hasBreakingInBody || hasExclamation) {
    return 'major';
  }

  const typeMatch = firstLine.match(/^([a-z]+)(?:\([^)]+\))?!?:\s/i);
  if (!typeMatch) return 'none';

  switch (typeMatch[1]!.toLowerCase()) {
    case 'feat':
      return 'minor';
    case 'fix':
    case 'perf':
      return 'patch';
    default:
      return 'none';
  }
}

function bumpVersion(version: string, bump: BumpType): string {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  switch (bump) {
    case 'major':
      // While pre-1.0, breaking changes advance the minor version.
      if (major === 0) return `0.${minor + 1}.0`;
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    case 'none':
      return version;
  }
}

function main(): void {
  const packageJsonPath = join(ROOT, 'package.json');

  const tags = execSync(`git tag -l '${TAG_PREFIX}*' --sort=-version:refname`, {
    encoding: 'utf-8',
    cwd: ROOT,
  })
    .trim()
    .split('\n')
    .filter(Boolean);

  const lastTag = tags[0];
  let currentVersion: string;

  if (!lastTag) {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version?: string };
    currentVersion = pkg.version || '0.1.0';
  } else {
    currentVersion = lastTag.replace(TAG_PREFIX, '');
  }

  const revRange = lastTag ? `${lastTag}..HEAD` : 'HEAD';
  const commitHashes = execSync(`git log ${revRange} --format=%H -- ${RELEVANT_PATHS.join(' ')}`, {
    encoding: 'utf-8',
    cwd: ROOT,
  })
    .trim()
    .split('\n')
    .filter(Boolean);

  let maxBump: BumpType = 'none';
  for (const hash of commitHashes) {
    const message = execSync(`git log -1 --format=%B ${hash}`, { encoding: 'utf-8', cwd: ROOT });
    const bump = parseConventionalCommit(message);
    if (BUMP_PRIORITY[bump] > BUMP_PRIORITY[maxBump]) {
      maxBump = bump;
    }
  }

  // Commits exist but none are feat/fix/perf → still publish a patch.
  if (maxBump === 'none' && commitHashes.length > 0) {
    maxBump = 'patch';
  }

  // First release keeps the package.json version as-is.
  const newVersion = lastTag ? bumpVersion(currentVersion, maxBump) : currentVersion;
  const newTag = `${TAG_PREFIX}${newVersion}`;

  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as Record<string, unknown>;
  pkg['version'] = newVersion;
  writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');

  execSync(`git tag ${newTag}`, { cwd: ROOT });
  execSync(`git push origin ${newTag}`, { cwd: ROOT });

  console.log(`Bumped to ${newVersion}, created and pushed tag ${newTag}`);
}

main();
