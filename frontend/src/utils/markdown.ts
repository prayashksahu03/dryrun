// A deliberately small Markdown reader for OA problem statements.
//
// It is NOT a general Markdown implementation and does not want to be. It
// parses exactly what the imported question bodies contain — ATX headings,
// fenced code, bullet/ordered lists, paragraphs, rules, and inline
// code/bold/italic — and it never emits HTML, so a hostile question body
// cannot inject markup. Anything it does not recognise falls through as plain
// text, which is the correct failure mode for a reading surface.
//
// The second half is the interesting part: `foldExamples` recognises the
// "## Example 1 / Input / ``` / Output / ```" shape the imported bodies use and
// lifts it out of the prose into a structured block, so the panel can render
// input/output as a proper pair instead of leaving it buried in the text.

// ── Inline spans ──────────────────────────────────────────────────────────

export type Span =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong'; v: string }
  | { t: 'em'; v: string };

export function parseInline(src: string): Span[] {
  const out: Span[] = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) { flush(); out.push({ t: 'code', v: src.slice(i + 1, end) }); i = end; continue; }
    }
    if (ch === '*' && src[i + 1] === '*') {
      const end = src.indexOf('**', i + 2);
      if (end > i + 2) { flush(); out.push({ t: 'strong', v: src.slice(i + 2, end) }); i = end + 1; continue; }
    }
    if (ch === '_' && src[i + 1] === '_') {
      const end = src.indexOf('__', i + 2);
      if (end > i + 2) { flush(); out.push({ t: 'strong', v: src.slice(i + 2, end) }); i = end + 1; continue; }
    }
    if (ch === '*') {
      const end = src.indexOf('*', i + 1);
      // A lone `*` (multiplication, a bullet mid-line) must stay literal.
      if (end > i + 1 && !/\s/.test(src[i + 1]) && src[end - 1] !== ' ') {
        flush(); out.push({ t: 'em', v: src.slice(i + 1, end) }); i = end; continue;
      }
    }
    buf += ch;
  }
  flush();
  return out;
}

/** Inline spans flattened back to plain text — used for label matching. */
export function spansToText(spans: Span[]): string {
  return spans.map(s => s.v).join('');
}

// ── Blocks ────────────────────────────────────────────────────────────────

export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; text: string; lang: string }
  | { kind: 'rule' }
  | { kind: 'example'; label: string; input: string; output: string; explanation: Block[] };

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([A-Za-z0-9+#._-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)\d{1,3}[.)]\s+(.*)$/;

/**
 * True when the body actually uses Markdown. Legacy scraped questions are flat
 * text where a stray `#` or `*` means nothing, so they keep their preformatted
 * rendering rather than being mangled by a parser they were never written for.
 */
export function looksLikeMarkdown(src: string): boolean {
  if (!src) return false;
  // Deliberately strict. Scraped legacy bodies are full of stray backticks and
  // `#` characters lifted out of code, and running one of those through the
  // block parser would silently reflow it and destroy its line breaks. Only a
  // body with real document structure — several ATX headings, and fences that
  // actually open and close — is treated as Markdown. Measured against the
  // question bank this admits every imported body and no legacy one.
  const headings = (src.match(/^\s{0,3}#{1,6}\s+\S/gm) || []).length;
  const h2       = (src.match(/^\s{0,3}##\s+\S/gm) || []).length;
  const fences   = (src.match(/^\s{0,3}(?:```|~~~)/gm) || []).length;
  return headings >= 2 && h2 >= 2 && fences >= 2;
}

/**
 * A looser test for short, generated prose (the editorial) where there is no
 * scraped-text hazard and one heading or one fence is enough to be worth
 * formatting.
 */
export function hasMarkdownMarkers(src: string): boolean {
  if (!src) return false;
  return /^\s{0,3}#{1,6}\s+\S/m.test(src) || /^\s{0,3}```/m.test(src) || /\*\*[^*\n]+\*\*/.test(src);
}

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1][0];
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s{0,3}${marker}{3,}\\s*$`).test(lines[i])) {
        body.push(lines[i]); i++;
      }
      i++; // consume the closing fence (or fall off the end — same result)
      blocks.push({ kind: 'code', text: body.join('\n'), lang: fence[2] || '' });
      continue;
    }

    const head = HEADING.exec(line);
    if (head) { blocks.push({ kind: 'heading', level: head[1].length, text: head[2] }); i++; continue; }

    if (RULE.test(line)) { blocks.push({ kind: 'rule' }); i++; continue; }

    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet || ordered) {
      const isOrdered = !bullet;
      const items: string[] = [];
      while (i < lines.length) {
        const b = BULLET.exec(lines[i]);
        const o = ORDERED.exec(lines[i]);
        const m = isOrdered ? o : b;
        if (m) { items.push(m[2]); i++; continue; }
        // A wrapped continuation line belongs to the item above it.
        if (items.length && lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && !FENCE.test(lines[i]) && !HEADING.test(lines[i])) {
          items[items.length - 1] += ' ' + lines[i].trim(); i++; continue;
        }
        break;
      }
      blocks.push({ kind: 'list', ordered: isOrdered, items });
      continue;
    }

    // Paragraph: consume until a blank line or a line that starts another block.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim()) {
      const l = lines[i];
      if (FENCE.test(l) || HEADING.test(l) || RULE.test(l) || BULLET.test(l) || ORDERED.test(l)) break;
      para.push(l.trim()); i++;
    }
    if (para.length) blocks.push({ kind: 'para', text: para.join(' ') });
    else i++; // defensive: never spin
  }

  return blocks;
}

// ── Example folding ───────────────────────────────────────────────────────

/** `**Input**`, `Input:`, `Input` — all the same label. */
function labelOf(b: Block): string | null {
  if (b.kind === 'heading') return b.text.replace(/[*_`]/g, '').replace(/:\s*$/, '').trim().toLowerCase();
  if (b.kind === 'para') {
    const t = b.text.replace(/[*_`]/g, '').trim();
    if (t.length > 40) return null;                 // a sentence, not a label
    return t.replace(/:\s*$/, '').trim().toLowerCase();
  }
  return null;
}

const EXAMPLE_HEAD = /^(?:example|sample\s*case|test\s*case|sample)\s*#?\s*(\d+)?$/i;
const SAMPLE_IN    = /^sample\s+input\s*#?\s*(\d+)?$/i;
const SAMPLE_OUT   = /^sample\s+output\s*#?\s*(\d+)?$/i;
const EXPLAIN_HEAD = /^explanation\s*#?\s*(\d+)?$/i;
/** "Explanation: the total is …" — the label and the prose share one paragraph. */
const EXPLAIN_INLINE = /^\s*(?:\*\*)?explanation(?:\*\*)?\s*[:.]\s*(\S[\s\S]*)$/i;

/** Drop the emphasis/backtick noise a label can be wrapped in. */
function strip(text: string): string {
  return text.replace(/[*_`:]/g, '').trim();
}

/**
 * The text of an "an example starts here" marker, or null. Both a heading
 * (`## Example 1`) and a bare emphasised line (`**Example 1**`) count — the
 * imported bodies use each about equally often.
 */
function exampleMarker(b: Block): string | null {
  if (b.kind === 'heading') {
    const t = strip(b.text);
    return EXAMPLE_HEAD.test(t) ? t : null;
  }
  if (b.kind === 'para') {
    const l = labelOf(b);
    if (!l || !EXAMPLE_HEAD.test(l)) return null;
    return strip(b.text);
  }
  return null;
}

/**
 * Turn the blocks inside one `## Example N` section into a structured example.
 * Returns null (and the caller leaves the prose untouched) unless BOTH an input
 * and an output were found — a half-parsed example is worse than none.
 */
function buildExample(inner: Block[], label: string): Block | null {
  let input: string | null = null;
  let output: string | null = null;
  const explanation: Block[] = [];
  let slot: 'input' | 'output' | 'explanation' | null = null;

  for (const b of inner) {
    const lab = labelOf(b);
    if (lab && /^input$/.test(lab))       { slot = 'input'; continue; }
    if (lab && /^output$/.test(lab))      { slot = 'output'; continue; }
    if (lab && EXPLAIN_HEAD.test(lab))    { slot = 'explanation'; continue; }

    if (b.kind === 'para') {
      const m = EXPLAIN_INLINE.exec(b.text);
      if (m) { slot = 'explanation'; explanation.push({ kind: 'para', text: m[1] }); continue; }
    }

    if (b.kind === 'code') {
      if (slot === 'input'  && input  === null) { input  = b.text; slot = null; continue; }
      if (slot === 'output' && output === null) { output = b.text; slot = null; continue; }
      // Some bodies drop the "Input" label and open the example with the fence
      // directly. The FIRST code block of an unlabelled example is the input —
      // but only the first, and only before anything else has been claimed.
      if (slot === null && input === null && output === null) { input = b.text; continue; }
      // …and its second unlabelled fence is the expected output. Only ever the
      // second: anything after that is left in the prose where it was written.
      if (slot === null && input !== null && output === null) { output = b.text; continue; }
    }

    if (slot === 'explanation') explanation.push(b);
  }

  if (input === null || output === null) return null;
  return { kind: 'example', label, input, output, explanation };
}

/**
 * Lift example sections out of the prose. Two shapes are recognised:
 *
 *   A.  ## Example 1        →  Input / ``` / Output / ``` / Explanation
 *   B.  ## Sample Input 0   →  ```   (then ## Sample Output 0, ## Explanation 0)
 *
 * Nothing is ever dropped: a section that does not parse cleanly is emitted
 * unchanged, exactly as it was written.
 */
export function foldExamples(blocks: Block[]): Block[] {
  const out: Block[] = [];
  let i = 0;

  while (i < blocks.length) {
    const b = blocks[i];
    const marker = exampleMarker(b);

    // Shapes A / C / D — one marker owns the example that follows it. The
    // marker is a heading (`## Example 1`) or a bare bold line (`**Example 1**`)
    // sitting under an `## Examples` umbrella; both are in the wild.
    if (marker !== null) {
      const level = b.kind === 'heading' ? b.level : null;
      let j = i + 1;
      while (j < blocks.length) {
        const nb = blocks[j];
        if (exampleMarker(nb) !== null) break;
        // A heading closes a paragraph-marked example outright; it closes a
        // heading-marked one only at the same or a shallower level.
        if (nb.kind === 'heading' && (level === null || nb.level <= level)) break;
        j++;
      }
      const ex = buildExample(blocks.slice(i + 1, j), marker);
      if (ex) { out.push(ex); i = j; continue; }
    }

    // Shape B — sibling headings, one per part (`## Sample Input 0`).
    if (b.kind === 'heading') {
      const head = strip(b.text);
      if (SAMPLE_IN.test(head)) {
        const n = SAMPLE_IN.exec(head)?.[1] ?? '';
        const inputBlock = blocks[i + 1];
        const outHead = blocks[i + 2];
        const outputBlock = blocks[i + 3];
        if (
          inputBlock?.kind === 'code' &&
          outHead?.kind === 'heading' && SAMPLE_OUT.test(strip(outHead.text)) &&
          outputBlock?.kind === 'code'
        ) {
          let j = i + 4;
          const explanation: Block[] = [];
          const expHead = blocks[j];
          if (expHead?.kind === 'heading' && EXPLAIN_HEAD.test(strip(expHead.text))) {
            j++;
            while (j < blocks.length) {
              const nb = blocks[j];
              if (nb.kind === 'heading' && nb.level <= expHead.level) break;
              explanation.push(nb); j++;
            }
          }
          out.push({
            kind: 'example',
            label: n ? `Sample ${n}` : 'Sample',
            input: inputBlock.text,
            output: outputBlock.text,
            explanation,
          });
          i = j;
          continue;
        }
      }
    }

    out.push(b);
    i++;
  }

  return out;
}

/** One call: text in, renderable blocks out. */
export function parseProblemBody(src: string): Block[] {
  return foldExamples(parseBlocks(src));
}
