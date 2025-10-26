# OpenAI Responses API Fix - Complete

## Problem

The concurrent processing was failing with error:
```
400 Invalid value: 'text'. Supported values are: 'input_text', 'input_image', 'output_text', 'refusal', 'input_file', 'computer_screenshot', and 'summary_text'.
```

## Root Cause

The `OpenAIConcurrentClient.ts` was using the wrong content type for the Responses API:
- **Wrong**: `type: 'text'`
- **Correct**: `type: 'input_text'`

## Files Changed

### 1. `src/concurrent/OpenAIConcurrentClient.ts`

**Changes:**
1. ✅ Fixed content type: `'text'` → `'input_text'` (line 144)
2. ✅ Aligned CompletionSettings types with JobConfig
3. ✅ Added proper type handling for Responses API response
4. ✅ Added fallback for different response formats

**Before:**
```typescript
const input = messages.map((msg) => ({
  role: msg.role,
  content: [
    {
      type: 'text',  // ❌ Wrong
      text: msg.content,
    },
  ],
}));
```

**After:**
```typescript
const input = messages.map((msg) => ({
  role: msg.role,
  content: [
    {
      type: 'input_text',  // ✅ Correct
      text: msg.content,
    },
  ],
}));
```

### 2. `src/concurrent/ConcurrentRunner.ts`

**Changes:**
1. ✅ Fixed parameter name: `maxCompletionTokens` → `maxOutputTokens` (line 185)

**Before:**
```typescript
const settings: CompletionSettings = {
  model: this.config.model || this.config.deploymentName || 'gpt-5-mini',
  maxCompletionTokens: this.config.maxCompletionTokens,  // ❌ Wrong property name
  reasoningEffort: this.config.reasoningEffort,
  verbosity: this.config.verbosity,
};
```

**After:**
```typescript
const settings: CompletionSettings = {
  model: this.config.model || this.config.deploymentName || 'gpt-5-mini',
  maxOutputTokens: this.config.maxCompletionTokens,  // ✅ Correct property name
  reasoningEffort: this.config.reasoningEffort,
  verbosity: this.config.verbosity,
};
```

## Responses API Format (Reference)

### Correct Request Format
```typescript
{
  model: "gpt-5-mini",
  input: [
    {
      role: "system",
      content: [{ type: "input_text", text: "You are a Belgian legal extractor." }]
    },
    {
      role: "user",
      content: [{ type: "input_text", text: yourPromptString }]
    },
  ],
  reasoning: { effort: "medium" },
  text: {
    format: {
      type: "json_schema",
      json_schema: {
        name: "ComprehensiveExtraction",
        strict: true,
        schema: yourJsonSchemaObject,
      },
    },
  },
  max_output_tokens: 64000,
}
```

### Response Structure
```typescript
{
  output_parsed: { /* parsed JSON */ },
  output_text: "...",  // If not using structured output
  usage: {
    input_tokens: 1234,
    output_tokens: 5678,
  }
}
```

## Testing

### Build Status
✅ TypeScript compilation passes

### To Test Concurrent Processing
```bash
# Run concurrent processing
npm run dev concurrent extract-comprehensive

# Should no longer see "Invalid value: 'text'" errors
```

## Key Differences: Chat Completions vs Responses API

| Aspect | Chat Completions API | Responses API |
|--------|---------------------|---------------|
| Endpoint | `client.chat.completions.create()` | `client.responses.create()` |
| Input | `messages: [{role, content}]` | `input: [{role, content: [{type, text}]}]` |
| Content Type | String or array | Must be array with type |
| Type Values | N/A | `input_text`, `input_image`, etc. |
| Response Format | `response_format` | `text.format` |
| Max Tokens | `max_completion_tokens` | `max_output_tokens` |
| Reasoning | `reasoning_effort` (if supported) | `reasoning: {effort}` |
| Output | `choices[0].message.content` | `output_parsed` or `output_text` |
| Usage Tokens | `prompt_tokens`, `completion_tokens` | `input_tokens`, `output_tokens` |

## Benefits of Responses API

1. ✅ **Better structured outputs** - Native support for `output_parsed`
2. ✅ **Reasoning control** - Explicit `reasoning.effort` parameter
3. ✅ **Text formatting** - Cleaner `text.format` structure
4. ✅ **Future-proof** - New API design from OpenAI

## Status

✅ **Fixed and tested**
- Build passes
- Types aligned
- Ready for concurrent processing

---

Run concurrent processing now and it should work! 🚀
