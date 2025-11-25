
import fs from 'fs';
import path from 'path';

const BASE_DIR = path.join(process.cwd(), 'full-data');
const DECISION_ID = 'ECLI:BE:GBAPD:2022:DEC.20220202.2';

const JOBS = [
  'extract-comprehensive',
  'enrich-provisions',
  'interpret-provisions',
  'extract-cited-decisions',
  'extract-keywords',
  'extract-legal-teachings',
  'extract-micro-summary',
  'enrich-provision-citations',
  'enrich-teaching-citations'
];

function getLatestTimestamp(jobId: string): string | null {
  const jobDir = path.join(BASE_DIR, jobId);
  if (!fs.existsSync(jobDir)) return null;

  const timestamps = fs.readdirSync(jobDir)
    .filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/.test(name))
    .sort()
    .reverse();

  return timestamps[0] || null;
}

function checkJob(jobId: string) {
  const ts = getLatestTimestamp(jobId);
  if (!ts) {
    console.log(`❌ ${jobId}: No timestamp found`);
    return;
  }

  const file = path.join(BASE_DIR, jobId, ts, 'jsons', 'ECLI_BE_GBAPD_2022_DEC.20220202.2_NL.json');
  if (!fs.existsSync(file)) {
    console.log(`❌ ${jobId}: File not found at ${file}`);
    return;
  }

  const content = fs.readFileSync(file, 'utf-8');
  const data = JSON.parse(content);
  const key = `${data.decision_id}|${data.language || data.language_metadata}`;
  
  console.log(`✅ ${jobId}: Key = "${key}"`);
  console.log(`   decision_id: "${data.decision_id}"`);
  console.log(`   language: "${data.language}"`);
  console.log(`   language_metadata: "${data.language_metadata}"`);
}

console.log('Checking keys for decision:', DECISION_ID);
JOBS.forEach(checkJob);
