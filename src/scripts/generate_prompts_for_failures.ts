import { DatabaseConfig } from '../config/database.js';
import config from '../jobs/enrich-teaching-citations/config.js';
import fs from 'fs';
import path from 'path';

const failures = [
  {
    "customId": "enrich-citations-0015",
    "reason": "Request Error",
    "error": "Processing error: 400 Your input exceeds the context window of this model. Please adjust your input and try again.",
    "decision_id": "ECLI:BE:GHCC:2010:ARR.095",
    "language": "FR",
    "metadata": {
      "id": 128423,
      "decision_id": "ECLI:BE:GHCC:2010:ARR.095",
      "language": "FR"
    }
  },
  {
    "customId": "enrich-citations-0016",
    "reason": "Request Error",
    "error": "Processing error: 400 Your input exceeds the context window of this model. Please adjust your input and try again.",
    "decision_id": "ECLI:BE:GBAPD:2022:DEC.20220202.1",
    "language": "FR",
    "metadata": {
      "id": 48018,
      "decision_id": "ECLI:BE:GBAPD:2022:DEC.20220202.1",
      "language": "FR"
    }
  },
  {
    "customId": "enrich-citations-0018",
    "reason": "Request Error",
    "error": "Processing error: 400 Your input exceeds the context window of this model. Please adjust your input and try again.",
    "decision_id": "ECLI:BE:GHCC:2012:ARR.053",
    "language": "FR",
    "metadata": {
      "id": 118450,
      "decision_id": "ECLI:BE:GHCC:2012:ARR.053",
      "language": "FR"
    }
  },
  {
    "customId": "enrich-citations-0014",
    "reason": "Request Error",
    "error": "Processing error: 400 Your input exceeds the context window of this model. Please adjust your input and try again.",
    "decision_id": "ECLI:BE:GHCC:2010:ARR.124",
    "language": "FR",
    "metadata": {
      "id": 148469,
      "decision_id": "ECLI:BE:GHCC:2010:ARR.124",
      "language": "FR"
    }
  },
  {
    "customId": "enrich-citations-0035",
    "reason": "Request Error",
    "error": "Processing error: 400 Your input exceeds the context window of this model. Please adjust your input and try again.",
    "decision_id": "ECLI:BE:HBANT:2005:ARR.20050413.11",
    "language": "NL",
    "metadata": {
      "id": 108871,
      "decision_id": "ECLI:BE:HBANT:2005:ARR.20050413.11",
      "language": "NL"
    }
  },
  {
    "customId": "enrich-citations-0017",
    "reason": "Request Error",
    "error": "Processing error: 400 Your input exceeds the context window of this model. Please adjust your input and try again.",
    "decision_id": "ECLI:BE:GBAPD:2022:DEC.20220202.2",
    "language": "NL",
    "metadata": {
      "id": 118001,
      "decision_id": "ECLI:BE:GBAPD:2022:DEC.20220202.2",
      "language": "NL"
    }
  },
  {
    "customId": "enrich-citations-0019",
    "reason": "Request Error",
    "error": "JSON parse error: Could not extract valid JSON from response content",
    "decision_id": "ECLI:BE:EAANT:2015:JUG.20150226.1",
    "language": "NL",
    "metadata": {
      "id": 167848,
      "decision_id": "ECLI:BE:EAANT:2015:JUG.20150226.1",
      "language": "NL"
    }
  }
];

async function main() {
  console.log(`Generating prompts for ${failures.length} failures...`);

  const outputDir = path.join(process.cwd(), 'failed_prompts');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  for (const failure of failures) {
    console.log(`Processing ${failure.decision_id}...`);

    // Construct row object expected by preprocessRow
    const row = {
      id: failure.metadata.id,
      decision_id: failure.decision_id,
      language_metadata: failure.language
    };

    try {
      // 1. Preprocess (loads dependencies and HTML, extracts blocks)
      if (!config.preprocessRow) {
          throw new Error("preprocessRow is undefined in config");
      }
      
      const enrichedRow = await config.preprocessRow(row);

      if (!enrichedRow) {
        console.error(`Skipping ${failure.decision_id}: Preprocessing returned null (missing dependencies or HTML)`);
        continue;
      }

      // 2. Generate Prompt
      if (!config.promptTemplate) {
          throw new Error("promptTemplate is undefined in config");
      }
      const prompt = config.promptTemplate(enrichedRow);

      // 3. Save to file
      const filename = `${failure.decision_id.replace(/:/g, '_')}_${failure.language}.txt`;
      const filepath = path.join(outputDir, filename);
      fs.writeFileSync(filepath, prompt);
      console.log(`Saved prompt to ${filepath}`);

    } catch (error) {
      console.error(`Error processing ${failure.decision_id}:`, error);
    }
  }

  // Close DB pool
  await DatabaseConfig.close();
}

main().catch(console.error);
