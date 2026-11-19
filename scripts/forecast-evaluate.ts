/** Offline only: no network, credentials, database writes, or production model changes. */
import { readFileSync, writeFileSync } from 'node:fs';
import { forecastArchive, evaluateForecasts, type ForecastArchive, type ForecastCase, type ForecastOutcome } from '../src/lib/league/forecastEvaluation.js';
import { historicalScoreBaselines } from '../src/lib/league/scoreBaseline.js';
import type { ScoresWeek } from '../src/lib/league/scores.js';

const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const write = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const [command, input, output, extra] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: npm run forecast:eval -- capture week.json archive.json | predict archive.json cases.json | evaluate cases.json outcomes.json report.json');
if (command === 'capture') {
  const capturedAt = new Date().toISOString();
  // Treat priors as available now. Never pretend a current dataset was known in a historical week.
  const archive: ForecastArchive = { schemaVersion: 1, capturedAt, priorAvailableAt: capturedAt,
    priors: Object.fromEntries(historicalScoreBaselines), week: read(input) as ScoresWeek };
  forecastArchive(archive);
  write(output, archive);
} else if (command === 'predict') {
  write(output, forecastArchive(read(input) as ForecastArchive));
} else if (command === 'evaluate' && extra) {
  write(extra, evaluateForecasts(read(input) as ForecastCase[], read(output) as ForecastOutcome[]));
} else throw new Error('Unknown command or missing report output path');
