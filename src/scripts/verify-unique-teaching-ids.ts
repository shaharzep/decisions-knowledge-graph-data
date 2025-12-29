/**
 * Verify all teaching IDs are unique in jsons-clean
 */

import fs from 'fs';
import path from 'path';

const jsonsDir = process.argv[2] || path.join(process.cwd(), 'full-data', 'classify-legal-issues', 'jsons-clean');

console.log(`\n📋 Scanning: ${jsonsDir}\n`);

const files = fs.readdirSync(jsonsDir).filter(f => f.endsWith('.json'));
console.log(`Found ${files.length} files\n`);

const teachingIds = new Map<string, string[]>(); // teaching_id -> [filenames]

for (const file of files) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(jsonsDir, file), 'utf-8'));
    const id = data.teaching_id;
    if (id) {
      if (!teachingIds.has(id)) {
        teachingIds.set(id, []);
      }
      teachingIds.get(id)!.push(file);
    }
  } catch (e) {
    console.error(`Error reading ${file}`);
  }
}

const duplicates = Array.from(teachingIds.entries()).filter(([_, files]) => files.length > 1);

console.log('='.repeat(50));
console.log('VERIFICATION RESULTS');
console.log('='.repeat(50));
console.log(`Total files:        ${files.length}`);
console.log(`Unique teaching IDs: ${teachingIds.size}`);
console.log(`Duplicates:         ${duplicates.length}`);

if (duplicates.length > 0) {
  console.log('\n⚠️ DUPLICATES FOUND:');
  for (const [id, fileList] of duplicates.slice(0, 20)) {
    console.log(`  ${id}:`);
    for (const f of fileList) {
      console.log(`    - ${f}`);
    }
  }
} else {
  console.log('\n✅ All teaching IDs are unique!');
}
