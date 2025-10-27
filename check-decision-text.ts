import { DatabaseConfig } from './src/config/database.js';

const decisionId = 'ECLI:BE:EABRL:2002:DEC.20021209.4';
const language = 'NL';

const result: any = await DatabaseConfig.executeReadOnlyQuery(
  'SELECT full_md FROM decisions_md WHERE decision_id = $1 AND language = $2',
  [decisionId, language]
);

if (result.length > 0) {
  const text = result[0].full_md;
  console.log(`\n📄 Decision: ${decisionId} (${language})`);
  console.log(`   Length: ${text.length} characters\n`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('FIRST 1500 CHARACTERS:');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(text.substring(0, 1500));
  console.log('\n═══════════════════════════════════════════════════════════');

  // Search for provision keywords
  const artikelMatches = (text.match(/\bartikel\b/gi) || []).length;
  const artMatches = (text.match(/\bart\.\s*\d+/gi) || []).length;

  console.log(`\n🔍 Provision keyword analysis:`);
  console.log(`   "artikel" mentions: ${artikelMatches}`);
  console.log(`   "art. <number>" mentions: ${artMatches}`);
  console.log(`   Total: ${artikelMatches + artMatches}`);

  if (artikelMatches + artMatches === 0) {
    console.log(`\n   ⚠️  This decision appears to have NO provision citations!`);
  }
} else {
  console.log(`❌ Decision not found in database`);
}

await DatabaseConfig.close();
