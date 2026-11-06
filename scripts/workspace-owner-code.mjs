#!/usr/bin/env node
// Owner bootstrap for the hosted workspace: makes a one-time Admin invitation code WITHOUT printing it.
// The code is written to .local/workspace/ (git-ignored, mode 600); only its SHA-256 and the SQL to run are printed.
// Run that SQL as the project owner (Supabase SQL editor or the Supabase MCP). Then open <site>/join with the code.
//
//   node scripts/workspace-owner-code.mjs "Organization name" admin@example.com
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [name, email] = process.argv.slice(2);
if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('Usage: node scripts/workspace-owner-code.mjs "Organization name" admin@example.com');
    process.exit(2);
}
const code = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(code).digest('hex');
const dir = join('.local', 'workspace');
mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = join(dir, `owner-code-${new Date().toISOString().slice(0, 10)}-${hash.slice(0, 8)}.txt`);
writeFileSync(file, `FinGence one-time Admin invitation\nOrganization: ${name}\nAdmin email: ${email}\nCode: ${code}\n\nOpen <site>/join, enter the code and choose a password. It works once, within 72 hours.\nDelete this file after use.\n`, { mode: 0o600, flag: 'wx' });
const quote = (s) => `'${s.replaceAll("'", "''")}'`;
console.log(`Code written to ${file} (not printed).`);
console.log(`Run as the project owner:\nselect public.fingence_workspace_bootstrap(${quote(name)}, ${quote(email.toLowerCase())}, '${hash}');`);
