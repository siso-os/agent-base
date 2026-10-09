import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

/**
 * Walk up directory tree to find .git folder and return the repo root, or null.
 */
function walkUpToRepo(startDir: string): string | null {
  let current = startDir;
  const root = path.parse(current).root;

  while (current !== root) {
    try {
      const stat = statSync(path.join(current, '.git'));
      if (stat.isDirectory() || stat.isFile()) {
        return current;
      }
    } catch {
      // .git doesn't exist or can't be stat'd, continue walking up
    }

    const parent = path.dirname(current);
    if (parent === current) break; // reached root
    current = parent;
  }

  return null;
}

export interface Brief {
  found: boolean;
  title?: string;
  writtenAt?: string | null;
  done?: string[];
  next?: string[];
  threads?: string[];
  keyPaths?: string[];
  words?: string;
}

const CREDENTIAL_PATTERNS = [
  /sk-[A-Za-z0-9]{10,}/,
  /ghp_[A-Za-z0-9]{10,}/,
  /xox[bp]-/,
  /BEGIN [A-Z ]*PRIVATE KEY/,
];

function isCredentialLine(line: string): boolean {
  return CREDENTIAL_PATTERNS.some(pattern => pattern.test(line));
}

function parseDate(dateStr: string): string | null {
  try {
    const iso = new Date(dateStr).toISOString();
    if (iso.includes('1970')) return null; // invalid date
    return iso;
  } catch {
    return null;
  }
}

/**
 * Find and parse an agent's entry from a HANDOFF markdown.
 * Entries are delimited by <!-- NAME-* START --> / <!-- NAME-* END --> markers
 * or by ## headings containing the name (case-insensitive).
 * Only reads first 400 KB of file.
 */
export function parseBrief(markdown: string, name: string): Brief {
  const maxBytes = 400 * 1024;
  const truncated = markdown.slice(0, maxBytes);
  
  const nameLower = name.toLowerCase();
  let entryText = '';
  let title = '';
  let writtenAt: string | null = null;

  // Try marker-based entry first: <!-- NAME-* START --> ... <!-- NAME-* END -->
  const startMarkerPattern = new RegExp(`<!--\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^-]*START\\s*-->`, 'i');
  const startMatch = truncated.match(startMarkerPattern);
  
  if (startMatch) {
    const startIdx = startMatch.index! + startMatch[0].length;
    const endMarkerPattern = new RegExp(`<!--\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^-]*END\\s*-->`, 'i');
    const endMatch = truncated.slice(startIdx).match(endMarkerPattern);
    entryText = truncated.slice(startIdx, endMatch ? startIdx + endMatch.index : truncated.length);
  } else {
    // Try heading-based entry: ## SOMETHING WITH NAME
    const lines = truncated.split('\n');
    let inEntry = false;
    let entryLines: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (!inEntry && line.startsWith('## ') && line.toLowerCase().includes(nameLower)) {
        inEntry = true;
        title = line.slice(3).trim();
        
        // Extract date from title if it has format "## DATE · NAME: ..."
        const dateMatch = title.match(/^(\d{1,2}\s+\w+\s+\d{4}(?:\s+~\s*\d{1,2}:\d{2})?)/i);
        if (dateMatch) {
          writtenAt = parseDate(dateMatch[1]) || null;
        }
        
        entryLines.push(line);
      } else if (inEntry) {
        // Stop at next ## heading
        if (line.startsWith('## ')) {
          break;
        }
        entryLines.push(line);
      }
    }
    
    entryText = entryLines.join('\n');
  }

  if (!entryText.trim()) {
    return { found: false };
  }

  // Extract labels from entry
  const done: string[] = [];
  const next: string[] = [];
  const threads: string[] = [];
  const keyPaths: string[] = [];
  let words = '';

  const lines = entryText.split('\n');
  let currentSection: 'done' | 'next' | 'threads' | 'keys' | 'words' | null = null;

  for (const line of lines) {
    // Skip credential lines
    if (isCredentialLine(line)) continue;

    // Check for section headers
    if (/^\*\*Done:\*\*/.test(line)) {
      currentSection = 'done';
      const rest = line.replace(/^\*\*Done:\*\*\s*/, '').trim();
      if (rest) done.push(rest);
      continue;
    }
    if (/^\*\*Next:\*\*/.test(line)) {
      currentSection = 'next';
      const rest = line.replace(/^\*\*Next:\*\*\s*/, '').trim();
      if (rest) next.push(rest);
      continue;
    }
    if (/^\*\*Open threads:\*\*/.test(line)) {
      currentSection = 'threads';
      const rest = line.replace(/^\*\*Open threads:\*\*\s*/, '').trim();
      if (rest) threads.push(rest);
      continue;
    }
    if (/^\*\*Key paths:\*\*/.test(line)) {
      currentSection = 'keys';
      const rest = line.replace(/^\*\*Key paths:\*\*\s*/, '').trim();
      if (rest) keyPaths.push(rest);
      continue;
    }
    if (/- \*\*(?:Done|Next|Open threads|Key paths):\*\*/.test(line)) {
      // Dash-prefixed label
      const match = line.match(/- \*\*([^:]+):\*\*\s*(.*)/);
      if (match) {
        const label = match[1].toLowerCase();
        const content = match[2].trim();
        if (label === 'done') {
          currentSection = 'done';
          if (content) done.push(content);
        } else if (label === 'next') {
          currentSection = 'next';
          if (content) next.push(content);
        } else if (label === 'open threads') {
          currentSection = 'threads';
          if (content) threads.push(content);
        } else if (label === 'key paths') {
          currentSection = 'keys';
          if (content) keyPaths.push(content);
        }
        continue;
      }
    }

    // Check for Shaan's words section (with or without ** markers)
    if (/^\*\*Shaan'?s words:\*\*/i.test(line) || /Shaan'?s words/i.test(line)) {
      currentSection = 'words';
      const rest = line.replace(/^\*\*Shaan'?s words:\*\*\s*/i, '').replace(/.*Shaan'?s words\s*[:–\-]?\s*/i, '').trim();
      if (rest) words = rest;
      continue;
    }

    // Collect content for current section
    const trimmed = line.trim();
    if (trimmed && currentSection) {
      if (trimmed.startsWith('- ')) {
        // List item
        const item = trimmed.slice(2).trim();
        if (currentSection === 'done') done.push(item);
        else if (currentSection === 'next') next.push(item);
        else if (currentSection === 'threads') threads.push(item);
        else if (currentSection === 'keys') keyPaths.push(item);
      } else if (currentSection === 'words' && !words) {
        words = trimmed;
      }
    }
  }

  const result: Brief = { found: true };
  if (title) result.title = title;
  if (writtenAt) result.writtenAt = writtenAt;
  if (done.length) result.done = done;
  if (next.length) result.next = next;
  if (threads.length) result.threads = threads;
  if (keyPaths.length) result.keyPaths = keyPaths;
  if (words) result.words = words;

  return result;
}

/**
 * Find the HANDOFF.md file for an agent.
 * 1. Check owner card repo field → <repo>/.agents/HANDOFF.md
 * 2. Check host file cwd, walk up to repo root → .agents/HANDOFF.md
 * 3. Return null if not found
 */
export async function findHandoff(
  name: string,
  options: { ownersDir?: string; hostsDir?: string } = {}
): Promise<string | null> {
  const ownersDir = options.ownersDir ?? path.join(homedir(), '.local/state/a0/owners');
  const hostsDir = options.hostsDir ?? path.join(homedir(), '.local/state/agent-base/hosts');

  // Try owner card first
  try {
    const ownerFile = path.join(ownersDir, `${name}.json`);
    const ownerData = JSON.parse(readFileSync(ownerFile, 'utf8'));
    if (ownerData.repo) {
      const handoffPath = path.join(ownerData.repo, '.agents/HANDOFF.md');
      const stat = statSync(handoffPath);
      if (stat.isFile()) return handoffPath;
    }
  } catch {
    // Fall through to host file
  }

  // Try host file
  try {
    const hostFile = path.join(hostsDir, `name-${name}.json`);
    const hostData = JSON.parse(readFileSync(hostFile, 'utf8'));
    if (hostData.cwd) {
      const repoRoot = walkUpToRepo(hostData.cwd);
      if (repoRoot) {
        const handoffPath = path.join(repoRoot, '.agents/HANDOFF.md');
        const stat = statSync(handoffPath);
        if (stat.isFile()) return handoffPath;
      }
    }
  } catch {
    // Fall through
  }

  return null;
}

export interface BriefCard {
  doing?: string;
  next?: string;
  summary?: string;
  updated?: string;
}

export interface BriefResponse {
  source: 'handoff' | 'card' | 'none';
  file?: string;
  mtime?: number;
  brief?: Brief;
  card?: BriefCard | null;
}

/**
 * Read and parse an agent's brief from its HANDOFF or card.
 */
export async function readBrief(name: string, owner?: any): Promise<BriefResponse> {
  const handoffPath = await findHandoff(name);
  
  if (handoffPath) {
    try {
      const markdown = readFileSync(handoffPath, 'utf8');
      const stat = statSync(handoffPath);
      const brief = parseBrief(markdown, name);
      
      return {
        source: 'handoff',
        file: handoffPath,
        mtime: stat.mtimeMs,
        brief: brief.found ? brief : undefined,
      };
    } catch {
      // Fall through to card
    }
  }

  // Fall back to card
  const card: BriefCard | null = owner ? {
    doing: owner.doing,
    next: owner.next,
    summary: owner.summary,
    updated: owner.updated,
  } : null;

  return {
    source: card ? 'card' : 'none',
    card: card?.doing ? card : null,
  };
}
