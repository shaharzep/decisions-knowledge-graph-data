import fs from 'fs';
import path from 'path';

/**
 * Load prompt from markdown file
 *
 * The canonical source is prompts-txts/AI Agent 5.md
 * This ensures prompt content stays synchronized with documentation
 */
const promptPath = path.join(process.cwd(), 'prompts-txts', 'AI Agent 5.md');
const promptContent = fs.readFileSync(promptPath, 'utf-8');

export const EXTRACT_LEGAL_TEACHINGS_PROMPT = promptContent;
