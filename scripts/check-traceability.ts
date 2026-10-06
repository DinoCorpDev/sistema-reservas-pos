/**
 * Checks that docs/TRAZABILIDAD.md covers ALL RF, RNF, RN and PA from docs/requerimientos.txt,
 * with no duplicates or invented IDs, the same priority as the document and an up-to-date
 * count summary. Runs in `pnpm test` and in CI.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const requirements = readFileSync(resolve(root, 'docs/requerimientos.txt'), 'utf8');
const traceability = readFileSync(resolve(root, 'docs/TRAZABILIDAD.md'), 'utf8');

const ID_PATTERN = /\b(RF-[A-F]\d{2}|RNF-\d{2}|RN-\d{2}|PA-\d{2})\b/g;
const EXPECTED_TOTALS = { RF: 126, RNF: 23, RN: 24, PA: 12 } as const;
type Kind = keyof typeof EXPECTED_TOTALS;
type Priority = 'DEBE' | 'DEBERÍA' | 'PODRÍA';

const kindOf = (id: string) => id.split('-')[0] as Kind;
const errors: string[] = [];

// 1. IDs and priorities from the source document.
const documentIds = new Set(requirements.match(ID_PATTERN) ?? []);
const documentPriority = new Map<string, Priority>();
for (const line of requirements.split(/\r?\n/)) {
  const match = /^\s*(RF-[A-F]\d{2}|RNF-\d{2})\s.*\s(DEBERÍA|PODRÍA|DEBE)\s*$/.exec(line);
  if (match?.[1] && match[2]) documentPriority.set(match[1], match[2] as Priority);
}

for (const kind of Object.keys(EXPECTED_TOTALS) as Kind[]) {
  const found = [...documentIds].filter((id) => kindOf(id) === kind).length;
  if (found !== EXPECTED_TOTALS[kind]) {
    errors.push(`The document has ${found} ${kind}, expected ${EXPECTED_TOTALS[kind]}.`);
  }
}

// 2. Rows of the traceability table.
const rows = new Map<string, string>();
for (const line of traceability.split(/\r?\n/)) {
  const match =
    /^\|\s*(RF-[A-F]\d{2}|RNF-\d{2}|RN-\d{2}|PA-\d{2})\s*\|[^|]*\|\s*([^|]+?)\s*\|/.exec(line);
  if (!match?.[1] || !match[2]) continue;
  if (rows.has(match[1])) errors.push(`${match[1]} appears twice in TRAZABILIDAD.md.`);
  rows.set(match[1], match[2]);
}

for (const id of documentIds) {
  if (!rows.has(id)) errors.push(`${id} is missing from TRAZABILIDAD.md.`);
}
for (const id of rows.keys()) {
  if (!documentIds.has(id)) errors.push(`${id} is in TRAZABILIDAD.md but not in the document.`);
}

// 3. Priorities identical to the document (RF and RNF).
for (const [id, priority] of rows) {
  const kind = kindOf(id);
  if (kind !== 'RF' && kind !== 'RNF') continue;
  const expected = documentPriority.get(id);
  if (!expected) errors.push(`Could not read the priority of ${id} in the document.`);
  else if (priority !== expected) {
    errors.push(
      `${id}: priority "${priority}" in TRAZABILIDAD.md, the document says "${expected}".`,
    );
  }
}

// 4. Summary table.
for (const kind of ['RF', 'RNF'] as const) {
  const ids = [...documentIds].filter((id) => kindOf(id) === kind);
  const count = (p: Priority) => ids.filter((id) => documentPriority.get(id) === p).length;
  const expected = [ids.length, count('DEBE'), count('DEBERÍA'), count('PODRÍA')];
  const summary = new RegExp(`^\\|\\s*${kind}\\s*\\|([^\\n]+)$`, 'm').exec(traceability);
  const actual = summary?.[1]
    ?.split('|')
    .map((cell) => cell.trim())
    .filter((cell) => cell !== '')
    .map(Number);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(
      `${kind} summary: shows ${JSON.stringify(actual)}, the document gives ${JSON.stringify(expected)} (total, DEBE, DEBERÍA, PODRÍA).`,
    );
  }
}

if (errors.length > 0) {
  console.error(`✗ Traceability incomplete (${errors.length} problems):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

const totals = (Object.keys(EXPECTED_TOTALS) as Kind[])
  .map((kind) => `${EXPECTED_TOTALS[kind]} ${kind}`)
  .join(', ');
console.log(`✓ Traceability complete: ${totals} with verified priorities.`);
