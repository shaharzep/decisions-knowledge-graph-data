You are verifying legal data extraction quality for production readiness. Compare the GROUND TRUTH snippets against the EXTRACTED JSON PAYLOAD.

═══════════════════════════════════════════════════
INPUT DATA
═══════════════════════════════════════════════════

GROUND TRUTH (Article Snippets from Source):
<ground_truth>
{ground_truth_snippets}
</ground_truth>

JSON PAYLOAD TO VERIFY:
<json_payload>
{extracted_output}
</json_payload>

ECLI: {ecli}
Decision Language: {proceduralLanguage}

═══════════════════════════════════════════════════

## EVALUATION FRAMEWORK

### 🔴 CRITICAL ISSUES (Automatic FAIL)
1. **No Provisions Found**: Empty `citedProvisions[]` when provisions clearly cited in ground truth
2. **Hallucinated Provisions**: Provisions in JSON that don't exist in ground truth
3. **Wrong Decision**: Extraction appears to be from different case entirely
4. **Wrong Parent Act**: Provision attributed to completely different law/code

### 🟠 MAJOR ISSUES (REVIEW Required if 2+)
1. **Missing Provisions**: >30% of ground truth provisions not in JSON
3. **Wrong Parent Act Details**: Correct law but wrong date/version (e.g., KB 1976 vs KB 1996)
4. **Incorrect Deduplication**: Same parent act has multiple `internalParentActId` values

### 🟡 MINOR ISSUES (Acceptable for PASS)
1. **One Missing Provision**: Single provision from ground truth not extracted
2. **Minor Text Variance**: Slight differences (e.g., "art. 31" vs "artikel 31")
3. **Missing Subdivision**: Core article present but §/alinéa not captured
4. **Missing Optional Date**: `parentActDate` null when date present in ground truth

## VERIFICATION CHECKLIST

### 1. Provision Coverage (CRITICAL)
- All provisions from ground truth present in JSON?
- Any provisions in JSON not in ground truth? (hallucinations)
- **Red flag**: Clear citations from ground truth missing

### 2. Parent Act Deduplication (MAJOR)
- Same law cited multiple times → same `internalParentActId`?
- Different laws → different `internalParentActId`?
- Example: Article 31 and Article 29 of "Loi du 10 mai 2007" must share parent ID
- **Red flag**: Same act has multiple parent IDs

### 3. Type Classification (MINOR)
- `parentActType` appropriate? (LOI/WET, CODE/WETBOEK, KB/KONINKLIJK_BESLUIT, etc.)
- Matches `proceduralLanguage`?
- **Note**: Minor enum errors acceptable

### 4. ID Format (Programmatic)
- `internalProvisionId`: Pattern `ART-{decisionId}-{sequence}`
- `internalParentActId`: Pattern `ACT-{decisionId}-{sequence}`

═══════════════════════════════════════════════════
REQUIRED OUTPUT FORMAT
═══════════════════════════════════════════════════

Return ONLY a JSON object with the following structure:

{
  "verdict": "PASS|FAIL|REVIEW_REQUIRED",
  "score": 85,
  "criticalIssues": [
    "Article XXX - HALLUCINATED: Provision in JSON not found in ground truth",
    "Article YYY - WRONG PARENT ACT: Attributed to incorrect law"
  ],
  "majorIssues": [
    "Article AAA - MISSING: Cited in ground truth but not in JSON"
  ],
  "minorIssues": [
    "Article BBB - Minor text variance (art. vs artikel)",
    "Article CCC - Missing optional date"
  ],
  "recommendation": "PROCEED|FIX_PROMPT|REVIEW_SAMPLES",
  "confidence": "HIGH|MEDIUM|LOW",
  "summary": "Brief overall assessment of extraction quality (2-3 sentences)"
}

## VERDICT LOGIC
- **FAIL**: Any critical issue present
- **REVIEW_REQUIRED**: 2+ major issues
- **PASS**: 0-1 major issues, no critical issues

## SCORING RUBRIC
- **90-100**: All provisions extracted, perfect parent act matching and deduplication
- **80-89**: Minor text variance or one missing provision
- **60-79**: Multiple major issues but no critical failures
- **0-59**: Critical issues or extensive quality problems

═══════════════════════════════════════════════════

IMPORTANT: Return ONLY the JSON object. No explanations before or after. Pure JSON only.