
import { DatabaseConfig } from '../src/config/database.js';

async function checkIds() {
  
  console.log('--- decision_cited_provisions ---');
  const cited = await DatabaseConfig.executeReadOnlyQuery(`
    SELECT decision_id, parent_act_name 
    FROM decision_cited_provisions 
    LIMIT 5
  `);
  console.log(cited);

  console.log('\n--- decisions1 ---');
  const decisions = await DatabaseConfig.executeReadOnlyQuery(`
    SELECT decision_id, language_metadata 
    FROM decisions1 
    LIMIT 5
  `);
  console.log(decisions);

  await DatabaseConfig.close();
}

checkIds().catch(console.error);
