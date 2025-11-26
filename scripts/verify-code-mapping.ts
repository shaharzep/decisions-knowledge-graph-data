
import fs from 'fs/promises';
import path from 'path';
import { DatabaseConfig } from '../src/config/database.js';

const MAPPING_FILE = 'src/jobs/map-provisions-code/code-mapping.json';
const OUTPUT_FILE = 'src/jobs/map-provisions-code/code-mapping-verification.json';

async function verifyMapping() {
  console.log('📖 Reading mapping file...');
  const content = await fs.readFile(MAPPING_FILE, 'utf-8');
  const mapping = JSON.parse(content);

  // Collect all document numbers
  const allDocNumbers: string[] = [];
  for (const codeName in mapping) {
    allDocNumbers.push(...mapping[codeName]);
  }

  console.log(`🔍 Found ${allDocNumbers.length} document numbers to verify.`);

  // Query database
  // Note: DatabaseConfig initializes pool lazily, no connect() needed
  const query = `
    SELECT document_number, title
    FROM documents
    WHERE document_number = ANY($1)
  `;

  console.log('📊 Querying database...');
  const rows = await DatabaseConfig.executeReadOnlyQuery(query, [allDocNumbers]);

  // Create lookup map
  const docMap = new Map<string, string>();
  for (const row of rows) {
    docMap.set(row.document_number, row.title);
  }

  // Reconstruct mapping with titles
  const verificationResult: Record<string, { document_number: string; title: string; found: boolean }[]> = {};

  for (const codeName in mapping) {
    verificationResult[codeName] = mapping[codeName].map((docNum: string) => {
      const title = docMap.get(docNum);
      return {
        document_number: docNum,
        title: title || '❌ NOT FOUND',
        found: !!title
      };
    });
  }

  // Write result
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(verificationResult, null, 2), 'utf-8');
  console.log(`✅ Verification complete. Results written to ${OUTPUT_FILE}`);

  await DatabaseConfig.close();
}

verifyMapping().catch(console.error);
