/**
 * Test Legal Reference Extractor
 *
 * Quick validation that the extractor works correctly with sample Belgian text
 */

import { extractLegalReferences } from './src/utils/legalReferenceExtractor.js';

const sampleText = `
Dit advies heeft betrekking op het voorontwerp van wet tot wijziging van de wet van
8 december 1992 tot bescherming van de persoonlijke levenssfeer ten opzichte van de
verwerking van persoonsgegevens (numac: 1999007004).

Zie artikel 29 en artikel 13 van voormelde wet.

De Commissie verwijst naar Richtlijn 2000/78/CE (CELEX: 32000L0078) en het
Règlement (UE) 2016/679 (GDPR).

Meer informatie: https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32016R0679

Justel referentie: http://www.ejustice.just.fgov.be/eli/wet/1998/12/11/1999007004/justel

Ook relevant: eli/be/loi/2007/05/10/2007202032
`;

console.log('Testing Legal Reference Extractor...\n');

const extracted = extractLegalReferences(sampleText);

console.log('Extracted References:');
console.log('====================\n');

console.log('ELI:', extracted.eli);
console.log('CELEX:', extracted.celex);
console.log('NUMAC:', extracted.numac);
console.log('EUR-Lex URLs:', extracted.eurLexUrls);
console.log('Justel URLs:', extracted.justelUrls);

console.log('\n✅ Extraction completed successfully!');
console.log(`\nFound: ${extracted.eli.length} ELI, ${extracted.celex.length} CELEX, ${extracted.numac.length} NUMAC, ${extracted.eurLexUrls.length} EUR-Lex URLs, ${extracted.justelUrls.length} Justel URLs`);
