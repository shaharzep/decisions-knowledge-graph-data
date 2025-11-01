/**
 * Test Legal Reference Extractor with Real Belgian Examples
 */

import { extractLegalReferences, hasAnyReferences } from './src/utils/legalReferenceExtractor.js';

console.log('Testing Legal Reference Extractor with Real Examples...\n');

// Real sample text with Belgian and EU references
const realText = `
Dit advies heeft betrekking op het voorontwerp van wet tot wijziging van de wet van
8 december 1992 tot bescherming van de persoonlijke levenssfeer (numac: 2023045678).

Zie artikel 29, §2 van voormelde wet en artikel 13 van de wet.

Dossier Numéro: 2023-01-15/12

De Commissie verwijst naar:
- Richtlijn 2000/78/CE (CELEX: 32000L0078)
- Règlement (UE) 2016/679 (GDPR) (CELEX 32016R0679)
- CJEU, C-311/18 (CELEX: 62019CJ0311)
- Commission Communication (CELEX 52020DC0066)

ELI references:
- eli/reg/2016/679/oj
- eli/dir/2019/1024/2019-06-20/oj
- eli/be/loi/2007/05/10/2007202032

URLs:
https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679
http://www.ejustice.just.fgov.be/eli/loi/2019/05/02/2019012345/justel
https://data.europa.eu/eli/reg/2016/679/oj

Article 31, §2 du Code civil dispose que...
L'article 1382 du C. civ. prévoit...
Artikel 98, 2° van de WOG...
`;

const extracted = extractLegalReferences(realText);

console.log('Extracted References:');
console.log('====================\n');

console.log('ELI:', extracted.eli);
console.log('CELEX:', extracted.celex);
console.log('NUMAC:', extracted.numac);
console.log('File Numbers:', extracted.fileNumber);
console.log('Data Europa URLs:', extracted.dataEuropa);
console.log('EUR-Lex URLs:', extracted.eurLexUrls);
console.log('Justel URLs:', extracted.justelUrls);
console.log('ETAAMB URLs:', extracted.etaamb);
console.log('Bibliographic Refs:', extracted.bibliographicRefs.slice(0, 5));

console.log('\n✅ Extraction completed successfully!');

const hasRefs = hasAnyReferences(extracted);
console.log(`\nHas enrichable references: ${hasRefs}`);

console.log(`\nCounts:`);
console.log(`  ELI: ${extracted.eli.length}`);
console.log(`  CELEX: ${extracted.celex.length}`);
console.log(`  NUMAC: ${extracted.numac.length}`);
console.log(`  File Numbers: ${extracted.fileNumber.length}`);
console.log(`  Total URLs: ${extracted.dataEuropa.length + extracted.eurLexUrls.length + extracted.justelUrls.length + extracted.etaamb.length}`);
console.log(`  Bibliographic Refs: ${extracted.bibliographicRefs.length}`);

// Test validation with real CELEX examples
console.log('\n\nValidating Real CELEX Examples:');
console.log('================================');

const realCelex = ['32016R0679', '62019CJ0311', '32019L1024', '52020DC0066', '32003R0001'];
realCelex.forEach(celex => {
  const found = extracted.celex.includes(celex);
  console.log(`  ${celex}: ${found ? '✓ Found' : '✗ Not found'}`);
});

// Test skip logic
console.log('\n\nTesting Skip Logic:');
console.log('===================');

const emptyText = 'This text has no legal references at all.';
const emptyRefs = extractLegalReferences(emptyText);
const shouldSkip = !hasAnyReferences(emptyRefs);
console.log(`Empty text should skip LLM: ${shouldSkip ? '✓ YES (cost saving)' : '✗ NO'}`);

const richText = 'CELEX: 32016R0679 and numac: 2023045678';
const richRefs = extractLegalReferences(richText);
const shouldNotSkip = hasAnyReferences(richRefs);
console.log(`Text with refs should NOT skip: ${shouldNotSkip ? '✓ Correct' : '✗ Wrong'}`);

console.log('\n✅ All tests completed!');
