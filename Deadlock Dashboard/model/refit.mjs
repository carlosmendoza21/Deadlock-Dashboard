// Downloads a fresh training set from the Deadlock API SQL endpoint and refits the model.
// Usage: node model/refit.mjs   (then rebuild the app)
// Note: the SQL endpoint is rate limited (2 req/min) and marked deprecated upstream.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(here, 'data'), { recursive: true });

async function query(sqlFile, outFile) {
  const sql = readFileSync(join(here, sqlFile), 'utf8');
  const url = 'https://api.deadlock-api.com/v1/sql?query=' + encodeURIComponent(sql);
  console.log(`Running ${sqlFile}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${sqlFile}: HTTP ${res.status} ${await res.text()}`);
  writeFileSync(join(here, 'data', outFile), await res.text());
}

await query('matches.sql', 'train.json');
console.log('Waiting 35s for the SQL rate limit...');
await new Promise(r => setTimeout(r, 35_000));
await query('ranked_badges.sql', 'ranks_hist.json');
execFileSync(process.execPath, [join(here, 'fit.cjs')], { stdio: 'inherit' });
console.log('Wrote src/model/model.json');
