import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Configuration
const BASE_DIR = path.join(process.cwd(), 'full-data');
const OUTPUT_DIR = path.join(process.cwd(), 'merged-full-data');

// Jobs to merge (Intersection)
const COMPLETED_JOBS = [
  { id: 'extract-comprehensive', field: 'comprehensive' },
  { id: 'enrich-provisions', field: 'extractedReferences' },
  { id: 'interpret-provisions', field: 'citedProvisions' },
  { id: 'extract-cited-decisions', field: 'citedDecisions' },
  { id: 'extract-keywords', field: 'customKeywords' },
  { id: 'extract-legal-teachings', field: 'legalTeachings' },
  { id: 'extract-micro-summary', field: 'microSummary' }
];

// Jobs to set to null
const NULL_JOBS = [
  { field: 'relatedCitationsLegalProvisions' }, // enrich-provision-citations
  { field: 'relatedCitationsLegalTeachings' }   // enrich-teaching-citations
];

// Fields to exclude from job data (metadata etc)
const EXCLUDED_FIELDS = [
  'id', 'court_ecli_code', 'court_name', 'decision_date',
  'decision_type_ecli_code', 'decision_type_name', 'md_length',
  'length_category', 'courtcategory', 'decision_id', 'language',
  'language_metadata', 'url_official_publication'
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

function loadJobData(jobId: string, timestamp: string): Map<string, any> {
  const jsonsDir = path.join(BASE_DIR, jobId, timestamp, 'jsons');
  const map = new Map<string, any>();

  if (!fs.existsSync(jsonsDir)) return map;

  const files = fs.readdirSync(jsonsDir).filter(f => f.endsWith('.json'));
  console.log(`   Loading ${files.length} files from ${jobId}/${timestamp}...`);

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(jsonsDir, file), 'utf-8');
      const data = JSON.parse(content);
      // Use composite key: decision_id|language
      const key = `${data.decision_id}|${data.language || data.language_metadata}`;
      map.set(key, data);
    } catch (err) {
      // ignore read errors
    }
  }
  return map;
}

function cleanJobData(jobData: any, outputField: string): any {
  // 1. Remove excluded fields
  const cleaned: any = {};
  for (const [key, value] of Object.entries(jobData)) {
    if (!EXCLUDED_FIELDS.includes(key)) {
      cleaned[key] = value;
    }
  }

  // 2. Structure based on field type
  switch (outputField) {
    case 'citedProvisions':
      return cleaned.citedProvisions || cleaned;
    case 'citedDecisions':
      return cleaned.citedDecisions || cleaned;
    case 'customKeywords':
      return cleaned.customKeywords || cleaned;
    case 'legalTeachings':
      return cleaned.legalTeachings || cleaned;
    case 'microSummary':
      return cleaned.microSummary || cleaned;
    case 'extractedReferences':
      return cleaned.extractedReferences || cleaned;
    case 'comprehensive':
      // Flatten comprehensive
      const flattened: any = {};
      if (cleaned.reference?.citationReference) flattened.citationReference = cleaned.reference.citationReference;
      if (cleaned.parties) flattened.parties = cleaned.parties;
      if (cleaned.currentInstance) flattened.currentInstance = cleaned.currentInstance;
      for (const [k, v] of Object.entries(cleaned)) {
        if (k !== 'reference' && k !== 'parties' && k !== 'currentInstance') {
          flattened[k] = v;
        }
      }
      return flattened;
    default:
      return cleaned;
  }
}

async function main() {
  console.log('🚀 Starting Full Data Merge...');

  // 1. Load all jobs
  const jobResults = new Map<string, Map<string, any>>();
  
  for (const job of COMPLETED_JOBS) {
    const ts = getLatestTimestamp(job.id);
    if (!ts) {
      console.error(`❌ No results found for ${job.id}`);
      process.exit(1);
    }
    console.log(`📦 Loading ${job.id} (latest: ${ts})...`);
    jobResults.set(job.id, loadJobData(job.id, ts));
  }

  // 2. Find Intersection
  console.log('\n🔍 Finding intersection...');
  const firstJobId = COMPLETED_JOBS[0].id;
  const firstJobMap = jobResults.get(firstJobId)!;
  const intersection = new Set<string>();

  for (const key of firstJobMap.keys()) {
    let presentInAll = true;
    for (const job of COMPLETED_JOBS) {
      if (!jobResults.get(job.id)!.has(key)) {
        presentInAll = false;
        break;
      }
    }
    if (presentInAll) {
      intersection.add(key);
    }
  }

  console.log(`✅ Found ${intersection.size} decisions present in ALL ${COMPLETED_JOBS.length} jobs.`);

  // 3. Merge
  console.log('\n🔄 Merging data...');
  const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, 'Z');
  const targetDir = path.join(OUTPUT_DIR, timestamp);
  fs.mkdirSync(targetDir, { recursive: true });

  let count = 0;
  for (const key of intersection) {
    const [decision_id, language] = key.split('|');
    const merged: any = { decision_id, language };

    // Add completed jobs
    for (const job of COMPLETED_JOBS) {
      const rawData = jobResults.get(job.id)!.get(key);
      const cleaned = cleanJobData(rawData, job.field);

      if (job.field === 'comprehensive') {
        Object.assign(merged, cleaned);
      } else {
        merged[job.field] = cleaned;
      }
    }

    // Add null jobs
    for (const nullJob of NULL_JOBS) {
      merged[nullJob.field] = null;
    }

    // Write file
    const filename = `${decision_id}_${language}.json`;
    fs.writeFileSync(path.join(targetDir, filename), JSON.stringify(merged, null, 2));
    count++;
    
    if (count % 1000 === 0) process.stdout.write('.');
  }

  console.log(`\n\n🎉 Successfully merged ${count} decisions to:`);
  console.log(`   ${targetDir}`);
}

main().catch(console.error);
