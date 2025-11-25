
import fs from 'fs';
import path from 'path';

const FILE_PATH = path.join(process.cwd(), 'full-data/enrich-provision-citations/2025-11-23T19-54-58-302Z/jsons/ECLI_BE_GBAPD_2022_DEC.20220202.2_NL.json');

if (!fs.existsSync(FILE_PATH)) {
  console.error('❌ File not found:', FILE_PATH);
  process.exit(1);
}

const content = fs.readFileSync(FILE_PATH, 'utf-8');
const data = JSON.parse(content);

// Add missing metadata
data.decision_id = "ECLI:BE:GBAPD:2022:DEC.20220202.2";
data.language = "NL";
data.language_metadata = "NL";

// Write back
fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2));
console.log('✅ Fixed metadata for ECLI:BE:GBAPD:2022:DEC.20220202.2');
