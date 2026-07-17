#!/usr/bin/env node
/**
 * Generate CHANGELOG.md from conventional commits, grouped by release tag
 * (`toolweave@<version>`), newest first. Commits between the newest tag and
 * HEAD appear under "Unreleased".
 *
 * Usage: jiti scripts/generate-changelog.ts [--commit]
 */

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '../..');
const TAG_PREFIX = 'toolweave@';
const REPO_URL = 'https://github.com/Pascal-Lohscheidt/toolweave';

const TYPE_LABELS: Record<string, string> = {
  feat: 'New features',
  fix: 'Bug fixes',
  perf: 'Performance',
  refactor: 'Improvements',
};

interface Commit {
  hash: string;
  subject: string;
}

function git(cmd: string): string {
  return execSync(cmd, { encoding: 'utf-8', cwd: ROOT }).trim();
}

function commitsBetween(from: string | undefined, to: string): Commit[] {
  const range = from ? `${from}..${to}` : to;
  const raw = git(`git log ${range} --format=%H%x1f%s%x1e`);
  if (!raw) return [];
  return raw
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash = '', subject = ''] = entry.split('\x1f');
      return { hash, subject };
    });
}

function renderSection(commits: Commit[]): string {
  const byType = new Map<string, Commit[]>();
  for (const commit of commits) {
    const match = commit.subject.match(/^([a-z]+)(?:\([^)]+\))?!?:\s*(.*)$/i);
    if (!match) continue;
    const type = match[1]!.toLowerCase();
    if (!(type in TYPE_LABELS)) continue;
    const list = byType.get(type) ?? [];
    list.push({ hash: commit.hash, subject: match[2]! });
    byType.set(type, list);
  }
  const parts: string[] = [];
  for (const [type, label] of Object.entries(TYPE_LABELS)) {
    const list = byType.get(type);
    if (list === undefined) continue;
    parts.push(`### ${label}\n`);
    for (const { hash, subject } of list) {
      parts.push(`- ${subject} ([${hash.slice(0, 7)}](${REPO_URL}/commit/${hash}))`);
    }
    parts.push('');
  }
  return parts.length > 0 ? parts.join('\n') : '_No user-facing changes._\n';
}

function main(): void {
  const tags = git(`git tag -l '${TAG_PREFIX}*' --sort=-version:refname`)
    .split('\n')
    .filter(Boolean);

  const sections: string[] = ['# Changelog\n'];

  const newestTag = tags[0];
  const unreleased = commitsBetween(newestTag, 'HEAD');
  if (unreleased.length > 0) {
    sections.push('## Unreleased\n');
    sections.push(renderSection(unreleased));
  }

  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i]!;
    const previous = tags[i + 1];
    const version = tag.replace(TAG_PREFIX, '');
    const date = git(`git log -1 --format=%as ${tag}`);
    sections.push(`## ${version} (${date})\n`);
    sections.push(renderSection(commitsBetween(previous, tag)));
  }

  const changelogPath = join(ROOT, 'CHANGELOG.md');
  writeFileSync(changelogPath, sections.join('\n').replace(/\n{3,}/g, '\n\n'));
  console.log(`Wrote ${changelogPath}`);

  if (process.argv.includes('--commit')) {
    execSync('git add CHANGELOG.md', { cwd: ROOT });
    execSync('git commit -m "docs(changelog): update CHANGELOG [skip ci]"', { cwd: ROOT });
    console.log('Committed changelog update.');
  }
}

main();
