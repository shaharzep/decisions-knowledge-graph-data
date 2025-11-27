import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function searchConstitution() {
  const dir = '/Users/shaharzep/ontology/stage1-data-extraction/full-data/map-provisions-standard/merged-results/jsons';
  
  console.log(`Searching in: ${dir}`);

  try {
    const files = await fs.readdir(dir);
    console.log(`Found ${files.length} files. Scanning...`);

    let matchCount = 0;
    let processedCount = 0;
    const matches: string[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = path.join(dir, file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const json = JSON.parse(content);

        // Check parent_act_name (case insensitive)
        const parentActName = json.parent_act_name || (json.metadata && json.metadata.parent_act_name);
        
        if (parentActName && typeof parentActName === 'string') {
          if (parentActName.toLowerCase().includes('constitution')) {
            matchCount++;
            matches.push(file);
            // console.log(`Match found: ${file} -> ${parentActName}`);
          }
        }
      } catch (err) {
        console.error(`Error reading ${file}:`, err);
      }

      processedCount++;
      if (processedCount % 10000 === 0) {
        process.stdout.write(`\rScanned ${processedCount} files...`);
      }
    }

    console.log('\n\nSearch Completed!');
    console.log(`Total Matches: ${matchCount}`);
    
    if (matchCount > 0) {
      console.log('\nFirst 20 matches:');
      matches.slice(0, 20).forEach(m => console.log(`- ${m}`));
      
      // Save list to file
      await fs.writeFile('constitution_matches.txt', matches.join('\n'), 'utf-8');
      console.log('\nFull list saved to constitution_matches.txt');
    }

  } catch (err) {
    console.error('Error:', err);
  }
}

searchConstitution().catch(console.error);
