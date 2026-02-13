/**
 * Pipeline Result Aggregator
 *
 * Transforms raw step results into the final merged-full-data format.
 * Mirrors the cleanJobData() logic from src/scripts/merge_full_data.ts,
 * producing an identical output schema.
 *
 * Output schema (top-level keys):
 *   decision_id              - from row
 *   language                 - from row (language_metadata)
 *   decision_date            - from row
 *   court_ecli_code          - from row
 *   citationReference        - from extract-comprehensive (flattened from reference.citationReference)
 *   parties                  - from extract-comprehensive (flattened)
 *   currentInstance           - from extract-comprehensive (flattened)
 *   extractedReferences      - from enrich-provisions      (.extractedReferences)
 *   citedProvisions          - from interpret-provisions    (.citedProvisions)
 *   citedDecisions           - from extract-cited-decisions (.citedDecisions)
 *   customKeywords           - from extract-keywords        (.customKeywords)
 *   legalTeachings           - from extract-legal-teachings (.legalTeachings)
 *   microSummary             - from extract-micro-summary   (.microSummary)
 *   relatedCitationsLegalProvisions - from enrich-provision-citations (.citedProvisions, renamed)
 *   relatedCitationsLegalTeachings  - from enrich-teaching-citations  (.legalTeachings, renamed)
 *   legalIssueClassifications       - from classify-legal-issues (whole result)
 *   full_html                       - from convert-md-to-html   (.full_html)
 *
 * Each step result may contain internal fields (_tokenUsage, metadata) that
 * must not leak into the output. The unwrap() helper extracts only the
 * expected field by key, falling back to the raw value if the key is absent.
 */

/**
 * Extract a single field from a step result object.
 *
 * Step results often wrap the useful data in a keyed property alongside
 * internal fields like `_tokenUsage` and `metadata`. This function extracts
 * only the desired field. If the key doesn't exist (e.g., the step already
 * returns a bare value), returns the data as-is.
 *
 * Uses `key in data` rather than truthiness to correctly handle falsy values
 * like empty strings or empty arrays.
 */
function unwrap(data: any, key: string): any {
  if (data != null && typeof data === 'object' && key in data) {
    return data[key];
  }
  return data;
}

/**
 * Aggregate all pipeline step results into a single output JSON.
 *
 * @param row      - The database row for this decision (contains decision_id,
 *                   language_metadata, decision_date, court_ecli_code, etc.)
 * @param stepResults - Map of step ID → step result data (as persisted to state files)
 * @returns The merged output object matching the merged-full-data schema
 */
export function aggregatePipelineResults(row: any, stepResults: Map<string, any>): any {
  const output: any = {
    decision_id: row.decision_id,
    language: row.language_metadata || row.language,
    decision_date: row.decision_date || null,
    court_ecli_code: row.court_ecli_code || null,
  };

  // --- extract-comprehensive → flatten to top-level ---
  // The LLM schema has 3 fields: reference, parties, currentInstance.
  // merge_full_data spreads comprehensive at top level after extracting
  // citationReference from the nested reference object.
  const comp = stepResults.get('extract-comprehensive');
  if (comp) {
    if (comp.reference?.citationReference) {
      output.citationReference = comp.reference.citationReference;
    }
    if (comp.parties) output.parties = comp.parties;
    if (comp.currentInstance) output.currentInstance = comp.currentInstance;
  }

  // --- enrich-provisions → extractedReferences ---
  // Step returns { citedProvisions, extractedReferences }
  const enrich = stepResults.get('enrich-provisions');
  if (enrich) {
    output.extractedReferences = unwrap(enrich, 'extractedReferences');
  }

  // --- interpret-provisions → citedProvisions ---
  // Step returns { citedProvisions, extractedReferences } after postProcess merge
  const interp = stepResults.get('interpret-provisions');
  if (interp) {
    output.citedProvisions = unwrap(interp, 'citedProvisions');
  }

  // --- extract-cited-decisions → citedDecisions ---
  // Step returns { citedDecisions } after postProcess
  const cited = stepResults.get('extract-cited-decisions');
  if (cited) {
    output.citedDecisions = unwrap(cited, 'citedDecisions');
  }

  // --- extract-keywords → customKeywords ---
  const kw = stepResults.get('extract-keywords');
  if (kw) {
    output.customKeywords = unwrap(kw, 'customKeywords');
  }

  // --- extract-legal-teachings → legalTeachings ---
  const teach = stepResults.get('extract-legal-teachings');
  if (teach) {
    output.legalTeachings = unwrap(teach, 'legalTeachings');
  }

  // --- extract-micro-summary → microSummary ---
  const micro = stepResults.get('extract-micro-summary');
  if (micro) {
    output.microSummary = unwrap(micro, 'microSummary');
  }

  // --- enrich-provision-citations → relatedCitationsLegalProvisions ---
  // Source field is 'citedProvisions', renamed to match merged-full-data schema
  const provCit = stepResults.get('enrich-provision-citations');
  if (provCit) {
    output.relatedCitationsLegalProvisions = unwrap(provCit, 'citedProvisions');
  }

  // --- enrich-teaching-citations → relatedCitationsLegalTeachings ---
  // Source field is 'legalTeachings', renamed to match merged-full-data schema
  const teachCit = stepResults.get('enrich-teaching-citations');
  if (teachCit) {
    output.relatedCitationsLegalTeachings = unwrap(teachCit, 'legalTeachings');
  }

  // --- classify-legal-issues → legalIssueClassifications ---
  // Whole result object: { classifications, totalTeachings, successCount, failCount }
  const classify = stepResults.get('classify-legal-issues');
  if (classify) {
    output.legalIssueClassifications = classify;
  }

  // --- convert-md-to-html → full_html ---
  const htmlStep = stepResults.get('convert-md-to-html');
  if (htmlStep) {
    output.full_html = unwrap(htmlStep, 'full_html');
  }

  return output;
}
