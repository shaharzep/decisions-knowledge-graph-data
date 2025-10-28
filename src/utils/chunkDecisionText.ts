export interface ChunkingOptions {
  maxChunkSize: number;
  overlap?: number;
}

export interface TextChunk {
  index: number;
  start: number;
  end: number;
  label: string;
  text: string;
}

interface Heading {
  index: number;
  title: string;
}

function collectHeadings(text: string): Heading[] {
  const headings: Heading[] = [];
  const regex = /^#{1,6}\s+(.+)$/gmu;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    headings.push({
      index: match.index,
      title: match[1].trim(),
    });
  }

  return headings;
}

function findLabel(headings: Heading[], start: number, defaultLabel: string): string {
  let label = defaultLabel;

  for (let i = headings.length - 1; i >= 0; i--) {
    if (headings[i].index <= start) {
      label = headings[i].title;
      break;
    }
  }

  return label;
}

function adjustBoundary(text: string, proposedEnd: number, start: number): number {
  if (proposedEnd >= text.length) {
    return text.length;
  }

  const segment = text.slice(start, proposedEnd);
  const doubleNewline = segment.lastIndexOf('\n\n');
  if (doubleNewline !== -1 && doubleNewline > segment.length * 0.3) {
    return start + doubleNewline + 2;
  }

  const singleNewline = segment.lastIndexOf('\n');
  if (singleNewline !== -1 && singleNewline > segment.length * 0.3) {
    return start + singleNewline + 1;
  }

  return proposedEnd;
}

export function chunkDecisionText(
  text: string,
  options: ChunkingOptions
): TextChunk[] {
  const maxChunkSize = Math.max(options.maxChunkSize, 4000);
  const overlap = Math.max(options.overlap ?? 0, 0);

  if (text.length <= maxChunkSize) {
    return [
      {
        index: 0,
        start: 0,
        end: text.length,
        label: 'Document complet',
        text,
      },
    ];
  }

  const headings = collectHeadings(text);
  const chunks: TextChunk[] = [];
  const totalLength = text.length;

  let start = 0;
  let index = 0;

  while (start < totalLength) {
    let end = Math.min(start + maxChunkSize, totalLength);
    end = adjustBoundary(text, end, start);

    if (end <= start) {
      end = Math.min(start + maxChunkSize, totalLength);
    }

    const chunkText = text.slice(start, end);
    const label = findLabel(headings, start, `Section ${index + 1}`);

    chunks.push({
      index,
      start,
      end,
      label,
      text: chunkText,
    });

    if (end === totalLength) {
      break;
    }

    const nextStart = end - Math.min(overlap, end - start);
    if (nextStart <= start) {
      start = end;
    } else {
      start = nextStart;
    }
    index++;
  }

  return chunks;
}
