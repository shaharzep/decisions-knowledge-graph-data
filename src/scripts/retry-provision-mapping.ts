import fs from 'fs/promises';
import path from 'path';

import { ConcurrentRunner } from '../concurrent/ConcurrentRunner.js';
import mapProvisionsStandardConfig from '../jobs/map-provisions-standard/config.js';
import { JobConfig } from '../jobs/JobConfig.js';




async function retryProvisionMapping() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: npx tsx src/scripts/retry-provision-mapping.ts <path-to-failures.json>');
    process.exit(1);
  }

  const failuresPath = args[0];
  console.log(`Loading failures from: ${failuresPath}`);

  const content = await fs.readFile(failuresPath, 'utf-8');
  const failures = JSON.parse(content);

  if (!Array.isArray(failures)) {
    throw new Error('Invalid failures.json format');
  }

  // Extract internal_parent_act_id
  const idsToRetry = new Set<string>();
  
  if (failures.length > 0) {
    console.log('First failure record:', JSON.stringify(failures[0], null, 2));
  }

  for (const failure of failures) {
    if (failure.metadata && failure.metadata.internal_parent_act_id) {
      idsToRetry.add(String(failure.metadata.internal_parent_act_id));
    }
  }

  if (idsToRetry.size === 0) {
    console.log('No retryable failures found (missing internal_parent_act_id).');
    return;
  }

  console.log(`Extracted IDs: ${[...idsToRetry].slice(0, 10).join(', ')}...`);

  // Create retry config
  const retryConfig: JobConfig = {
    ...mapProvisionsStandardConfig,
    id: `${mapProvisionsStandardConfig.id}-retry`,
    
    // Override query to filter by IDs
    dbQuery: `
      SELECT DISTINCT ON (dcp.internal_parent_act_id)
        dcp.internal_parent_act_id,
        d.decision_id,
        d.language_metadata,
        dcp.parent_act_name,
        dcp.parent_act_date,
        dcp.parent_act_type,
        (
          SELECT ARRAY_AGG(dlt.teaching_text)
          FROM decision_legal_teachings dlt
          WHERE dlt.decision_id = dcp.decision_id
        ) as teaching_texts
      FROM decision_cited_provisions dcp
      JOIN decisions1 d ON d.id = dcp.decision_id
      WHERE dcp.internal_parent_act_id = ANY($1)
      ORDER BY dcp.internal_parent_act_id
    `,
    dbQueryParams: [[...idsToRetry]],
    
    // Force full data pipeline
    useFullDataPipeline: true,
    
    // Use a specific output directory for this retry
    customOutputDirectory: path.join(path.dirname(failuresPath), 'retry-run')
  };

  console.log('Starting retry job...');
  const runner = new ConcurrentRunner(retryConfig, {
    concurrencyLimit: 50
  });

  await runner.run();
  console.log('Retry completed.');
}

retryProvisionMapping().catch(console.error);
