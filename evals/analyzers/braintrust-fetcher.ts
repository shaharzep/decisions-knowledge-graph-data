/**
 * Braintrust API Fetcher
 *
 * Fetches experiment results from Braintrust via REST API
 */

import dotenv from 'dotenv';
import {
  BraintrustEvent,
  BraintrustFetchResponse,
  ExperimentEvaluation,
  Verdict,
  Recommendation,
  Confidence,
} from '../types.js';

dotenv.config();

/**
 * Get experiment ID by name
 *
 * Searches for an experiment by name in the project and returns its ID.
 * If the input is already a UUID, returns it as-is.
 *
 * @param experimentNameOrId - Experiment name or ID
 * @param projectName - Project name (default: belgian-legal-extraction)
 * @returns Experiment ID (UUID)
 */
export async function getExperimentId(
  experimentNameOrId: string,
  projectName: string = 'belgian-legal-extraction'
): Promise<string> {
  // If it's already a UUID (contains hyphens), return as-is
  if (experimentNameOrId.includes('-') && experimentNameOrId.length > 30) {
    return experimentNameOrId;
  }

  const apiKey = process.env.BRAINTRUST_API_KEY;
  if (!apiKey) {
    throw new Error('BRAINTRUST_API_KEY not found in environment variables');
  }

  console.log(`🔍 Looking up experiment: ${experimentNameOrId} in project: ${projectName}`);

  // Build URL to list experiments
  const url = new URL('https://api.braintrust.dev/v1/experiment');
  url.searchParams.set('project_name', projectName);
  url.searchParams.set('experiment_name', experimentNameOrId);
  url.searchParams.set('limit', '1');

  // Make API request
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Braintrust API error (${response.status}): ${errorText}`
    );
  }

  const data = await response.json();

  if (!data.objects || data.objects.length === 0) {
    throw new Error(
      `Experiment "${experimentNameOrId}" not found in project "${projectName}"`
    );
  }

  const experimentId = data.objects[0].id;
  console.log(`✅ Found experiment ID: ${experimentId}\n`);

  return experimentId;
}

/**
 * Fetch all results from a Braintrust experiment
 *
 * Uses pagination to fetch all events from the experiment.
 * Deduplicates by event ID to handle overlapping pages.
 *
 * @param experimentId - Braintrust experiment ID (UUID)
 * @returns Array of Braintrust events
 */
export async function fetchExperimentResults(
  experimentId: string
): Promise<BraintrustEvent[]> {
  const apiKey = process.env.BRAINTRUST_API_KEY;
  if (!apiKey) {
    throw new Error('BRAINTRUST_API_KEY not found in environment variables');
  }

  console.log(`\n🔍 Fetching experiment results for: ${experimentId}`);

  const allEvents = new Map<string, BraintrustEvent>(); // Deduplicate by ID
  let cursor: string | null | undefined = undefined;
  let pageCount = 0;

  while (true) {
    pageCount++;
    const batchSize = 1000; // Fetch 1000 at a time

    // Build URL
    const url = new URL(
      `https://api.braintrust.dev/v1/experiment/${experimentId}/fetch`
    );
    url.searchParams.set('limit', batchSize.toString());
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    console.log(`   Fetching page ${pageCount}...`);

    // Make API request
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Braintrust API error (${response.status}): ${errorText}`
      );
    }

    const data: BraintrustFetchResponse = await response.json();

    // Add events to map (deduplicate by ID)
    for (const event of data.events) {
      allEvents.set(event.id, event);
    }

    console.log(
      `   Fetched ${data.events.length} events (total unique: ${allEvents.size})`
    );

    // Check if there are more pages
    if (!data.cursor) {
      break; // No more pages
    }

    cursor = data.cursor;
  }

  const events = Array.from(allEvents.values());

  console.log(`✅ Fetched ${events.length} total events across ${pageCount} pages\n`);

  return events;
}

/**
 * Parse Braintrust events into structured evaluations
 *
 * Extracts metadata and evaluation results from raw Braintrust events.
 * Checks both event.metadata (new evaluations) and event.input.extracted_data (existing evaluations).
 *
 * @param events - Array of Braintrust events
 * @returns Array of parsed experiment evaluations
 */
export function extractMetadataFromEvents(
  events: BraintrustEvent[]
): ExperimentEvaluation[] {
  const evaluations: ExperimentEvaluation[] = [];

  for (const event of events) {
    const metadata = event.metadata;
    const extractedData = event.input?.extracted_data || {};

    // Parse verdict (with fallback)
    const verdict: Verdict =
      (metadata.verdict as Verdict) || 'REVIEW_REQUIRED';

    // Parse recommendation (with fallback)
    const recommendation: Recommendation =
      (metadata.recommendation as Recommendation) || 'REVIEW_SAMPLES';

    // Parse confidence (with fallback)
    const confidence: Confidence =
      (metadata.confidence as Confidence) || 'MEDIUM';

    // Extract decision metadata from TWO possible locations:
    // 1. event.metadata (NEW evaluations with updated logging)
    // 2. event.input.extracted_data (EXISTING evaluations where metadata was merged into extraction output)
    // Priority: metadata first, then extracted_data as fallback
    const language = metadata.language || extractedData.language;
    const decisionTypeEcliCode =
      metadata.decision_type_ecli_code || extractedData.decision_type_ecli_code;
    const decisionTypeName =
      metadata.decision_type_name || extractedData.decision_type_name;
    const courtEcliCode =
      metadata.court_ecli_code || extractedData.court_ecli_code;
    const courtName = metadata.court_name || extractedData.court_name;
    const courtCategory = metadata.courtcategory || extractedData.courtcategory;
    const decisionDate = metadata.decision_date || extractedData.decision_date;
    const mdLength = metadata.md_length || extractedData.md_length;
    const lengthCategory =
      metadata.length_category || extractedData.length_category;

    const evaluation: ExperimentEvaluation = {
      decisionId: metadata.decision_id,
      verdict,
      overallScore: metadata.overall_score || 0,
      productionReady: metadata.production_ready || false,
      criticalIssuesCount: metadata.critical_issues_count || 0,
      majorIssuesCount: metadata.major_issues_count || 0,
      minorIssuesCount: metadata.minor_issues_count || 0,
      recommendation,
      confidence,

      // Decision metadata (from metadata or extracted_data)
      language,
      decisionTypeEcliCode,
      decisionTypeName,
      courtEcliCode,
      courtName,
      courtCategory,
      decisionDate,
      mdLength,
      lengthCategory,
    };

    evaluations.push(evaluation);
  }

  console.log(`✅ Parsed ${evaluations.length} evaluations\n`);

  return evaluations;
}
