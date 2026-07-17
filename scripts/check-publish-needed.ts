#!/usr/bin/env node
/**
 * Decide whether a publish is needed: exit 0 = publish, exit 1 = skip.
 * Publish when no release tag exists yet, or when files relevant to the
 * package changed since the last `toolweave@<version>` tag.
 *
 * Usage: jiti scripts/check-publish-needed.ts
 */

import { execSync } from 'node:child_process';

const TAG_PREFIX = 'toolweave@';
const RELEVANT_PREFIXES = ['src/', 'package.json', 'vite.config.ts'];

function main(): void {
  const tags = execSync(`git tag -l '${TAG_PREFIX}*' --sort=-version:refname`, {
    encoding: 'utf-8',
  })
    .trim()
    .split('\n')
    .filter(Boolean);

  const lastTag = tags[0];
  if (!lastTag) {
    console.log('No release tag yet — first release.');
    process.exit(0);
  }

  const changedFiles = execSync(`git diff --name-only ${lastTag}..HEAD`, { encoding: 'utf-8' })
    .trim()
    .split('\n')
    .filter(Boolean);

  const relevant = changedFiles.filter((file) =>
    RELEVANT_PREFIXES.some((prefix) => file.startsWith(prefix)),
  );

  if (relevant.length > 0) {
    console.log(`Publishing: ${relevant.length} relevant change(s) since ${lastTag}.`);
    process.exit(0);
  }

  console.log(`Skipping publish: nothing relevant changed since ${lastTag}.`);
  process.exit(1);
}

main();
