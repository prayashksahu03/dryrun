import { useRef, useEffect, useState } from 'react';
import { useExecutionStore, Language } from '../store/executionStore';

// ── Syntax highlighting ───────────────────────────────────────────────

function highlight(raw: string, lang: Language): string {
  let s = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  if (lang === 'python') {
    return s
      .replace(/(#[^\n]*)/g, '<span style="color:#52525b">$1</span>')
      .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, '<span style="color:#86efac">$1</span>')
      .replace(/\b(0x[0-9a-fA-F]+|\d+(?:\.\d+)?)\b/g, '<span style="color:#fcd34d">$1</span>')
      .replace(
        /\b(def|class|return|if|elif|else|for|while|in|not|and|or|import|from|as|with|try|except|finally|raise|pass|break|continue|lambda|yield|global|nonlocal|assert|del|True|False|None)\b/g,
        '<span style="color:#c084fc">$1</span>',
      )
      .replace(/\b(print|range|len|min|max|abs|sum|sorted|enumerate|zip|map|filter|list|dict|set|tuple|int|str|float|bool|input|append|extend)\b/g,
        '<span style="color:#60a5fa">$1</span>');
  }

  // C / C++ (shared base)
  s = s
    .replace(/(\/\/[^\n]*)/g, '<span style="color:#52525b">$1</span>')
    .replace(/("(?:[^"\\]|\\.)*")/g, '<span style="color:#86efac">$1</span>')
    .replace(/\b(0x[0-9a-fA-F]+)\b/g, '<span style="color:#67e8f9">$1</span>')
    .replace(/\b(\d+)\b/g, '<span style="color:#fcd34d">$1</span>')
    .replace(
      /\b(struct|int|char|void|return|if|else|while|for|do|sizeof|NULL|include|define|long|unsigned|short|const|static|inline|typedef|auto|bool|true|false|nullptr)\b/g,
      '<span style="color:#c084fc">$1</span>',
    )
    .replace(/\b(malloc|free|calloc|realloc|printf|scanf|min|max|abs|cout|cin|endl)\b/g,
      '<span style="color:#60a5fa">$1</span>');

  if (lang === 'cpp') {
    s = s.replace(
      /\b(class|namespace|template|vector|string|pair|map|set|unordered_map|stack|queue|using|new|delete|override|virtual|public|private|protected)\b/g,
      '<span style="color:#f0abfc">$1</span>',
    );
  }

  return s;
}

// ── Error parsing ─────────────────────────────────────────────────────

function parseErrorLine(msg: string): number | null {
  const m = msg.match(/(?:^|\n)\s*[Ll]ine\s+(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function parseErrorType(msg: string): string {
  if (/segfault|segmentation|null pointer|use-after-free|double free/i.test(msg)) return 'Runtime Error';
  if (/is never defined|not declared|undeclared/i.test(msg)) return 'Undefined Symbol';
  if (/syntax|unexpected|expected/i.test(msg)) return 'Syntax Error';
  if (/parse error/i.test(msg)) return 'Parse Error';
  if (/NameError|TypeError|ValueError|IndexError|AttributeError/i.test(msg)) return 'Runtime Error';
  return 'Error';
}

// ── Language selector ─────────────────────────────────────────────────

const LANG_LABELS: Record<Language, string> = { c: 'C', cpp: 'C++', python: 'Python' };
const LANG_FILE:   Record<Language, string> = { c: 'main.c', cpp: 'main.cpp', python: 'main.py' };

const DEFAULT_CPP = `#include <bits/stdc++.h>
using namespace std;

int uniquePaths(int m, int n) {
    vector<vector<int>> dp(m, vector<int>(n, 0));
    for (int i = 0; i < m; i++) dp[i][0] = 1;
    for (int j = 0; j < n; j++) dp[0][j] = 1;
    for (int i = 1; i < m; i++)
        for (int j = 1; j < n; j++)
            dp[i][j] = dp[i-1][j] + dp[i][j-1];
    return dp[m-1][n-1];
}

int main() {
    int result = uniquePaths(4, 4);
    return 0;
}
`;


// ── Code panel (always editable, overlays trace highlight when active) ──

function EditorMode() {
  const {
    editorSource, setEditorSource, stdinInput, setStdinInput,
    runCode, isLoading, error, language,
    trace, currentFrame, clearTrace,
  } = useExecutionStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [stdinOpen, setStdinOpen] = useState(true);
  const errorLine   = error ? parseErrorLine(error) : null;
  const errorType   = error ? parseErrorType(error) : null;

  const frame       = currentFrame();
  const currentLine = frame?.line ?? -1;
  const isCrash     = frame?.event.type === 'crash';

  // Scroll gutter to keep active line visible when stepping
  useEffect(() => {
    if (activeLineRef.current && gutterRef.current) {
      activeLineRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [currentLine]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      runCode();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta   = textareaRef.current!;
      const start = ta.selectionStart;
      const end   = ta.selectionEnd;
      const indent = '    ';
      const next  = editorSource.substring(0, start) + indent + editorSource.substring(end);
      setEditorSource(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + indent.length;
      });
    }
  };

  const lines = editorSource.split('\n');

  return (
    <div data-tour="code-editor" className="flex flex-col border-r border-zinc-800/60 bg-[#0d0d0f] overflow-hidden h-full w-full">
      {/* Toolbar */}
      <div data-tour="code-toolbar" className="flex items-center justify-between px-3 h-9 border-b border-zinc-800/60 bg-[#111113] flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
          <span className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
          <span className="ml-2 text-xs text-zinc-500 font-mono">{LANG_FILE[language]}</span>
        </div>
        <div />
        <div className="flex items-center gap-2">
          <button
            data-tour="run-button"
            onClick={runCode}
            disabled={isLoading}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono font-medium transition-all ${
              isLoading
                ? 'bg-violet-500/20 text-violet-400 cursor-wait'
                : 'bg-violet-500/25 text-violet-300 hover:bg-violet-500/40 border border-violet-500/30 hover:border-violet-500/50'
            }`}
            title="Run (⌘ Enter)"
          >
            {isLoading ? (
              <>
                <span className="w-2.5 h-2.5 border border-violet-400/60 border-t-violet-400 rounded-full animate-spin" />
                running...
              </>
            ) : (
              <>▶ Run</>
            )}
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Line gutter */}
        <div
          ref={gutterRef}
          className="gutter-no-scrollbar flex-shrink-0 w-10 text-right py-3 pr-2 text-xs font-mono leading-relaxed select-none bg-[#0d0d0f] pointer-events-none"
          style={{ overflowY: 'scroll', scrollbarWidth: 'none' }}
          aria-hidden
        >
          {lines.map((_, i) => {
            const ln = i + 1;
            const isErr = errorLine === ln;
            const isActive = trace && ln === currentLine;
            const isCrashLn = isActive && isCrash;
            return (
              <div
                key={i}
                ref={isActive ? activeLineRef : undefined}
                className={`leading-[1.6rem] pr-1 ${
                  isCrashLn ? 'text-red-400' : isActive ? 'text-amber-400' : isErr ? 'text-red-400' : 'text-zinc-700'
                }`}
              >
                {isCrashLn ? '✕' : isActive ? '▶' : isErr ? '✕' : ln}
              </div>
            );
          })}
        </div>

        {/* Active-line highlight stripe (trace mode) */}
        {trace && currentLine > 0 && currentLine <= lines.length && (
          <div
            className="absolute pointer-events-none z-0"
            style={{
              top: `calc(0.75rem + ${(currentLine - 1) * 1.6}rem - ${scrollTop}px)`,
              left: 40,
              right: 0,
              height: '1.6rem',
              background: isCrash ? 'rgba(239,68,68,0.1)' : 'rgba(251,191,36,0.07)',
              borderLeft: `2px solid ${isCrash ? 'rgba(239,68,68,0.5)' : 'rgba(251,191,36,0.4)'}`,
            }}
          />
        )}

        {/* Error stripe (compile/parse error, no trace) */}
        {!trace && errorLine && errorLine <= lines.length && (
          <div
            className="absolute pointer-events-none z-0"
            style={{
              top: `calc(0.75rem + ${(errorLine - 1) * 1.6}rem - ${scrollTop}px)`,
              left: 40,
              right: 0,
              height: '1.6rem',
              background: 'rgba(239,68,68,0.08)',
              borderLeft: '2px solid rgba(239,68,68,0.5)',
            }}
          />
        )}

        <textarea
          ref={textareaRef}
          value={editorSource}
          onChange={e => { clearTrace(); setEditorSource(e.target.value); }}
          onKeyDown={handleKeyDown}
          onScroll={() => {
            if (gutterRef.current && textareaRef.current) {
              gutterRef.current.scrollTop = textareaRef.current.scrollTop;
              setScrollTop(textareaRef.current.scrollTop);
            }
          }}
          spellCheck={false}
          className="flex-1 bg-transparent text-zinc-300 text-xs font-mono leading-[1.6rem] py-3 pr-4 resize-none outline-none border-none relative z-10"
          style={{ caretColor: '#c084fc' }}
          placeholder={`Write your ${LANG_LABELS[language]} code here...`}
        />
      </div>

      {/* stdin panel */}
      {language === 'cpp' && (
        <div className="border-t border-zinc-800/60 flex-shrink-0">
          <button
            onClick={() => setStdinOpen(o => !o)}
            className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-zinc-800/40 transition-colors"
          >
            <span className="flex items-center gap-1.5 text-[10px] font-mono text-cyan-600/80">
              <span className={`transition-transform duration-150 text-[8px] ${stdinOpen ? 'rotate-90' : ''}`}>▶</span>
              stdin
            </span>
            {stdinInput.trim() && (
              <span className="text-cyan-700 text-[9px] font-mono">
                {stdinInput.trim().split(/\s+/).length} token{stdinInput.trim().split(/\s+/).length !== 1 ? 's' : ''}
              </span>
            )}
            {!stdinInput.trim() && (
              <span className="text-zinc-700 text-[9px] font-mono">values for cin &gt;&gt;</span>
            )}
          </button>
          {stdinOpen && (
            <textarea
              value={stdinInput}
              onChange={e => setStdinInput(e.target.value)}
              placeholder="Space or newline separated values for cin&#10;e.g.  5  hello  3.14"
              spellCheck={false}
              className="w-full bg-[#080809] text-cyan-300 text-[11px] font-mono px-3 py-2 resize-none outline-none border-none leading-relaxed placeholder:text-zinc-700"
              style={{ height: 56, caretColor: '#22d3ee', borderTop: '1px solid rgba(34,211,238,0.08)' }}
            />
          )}
        </div>
      )}

      {/* Bottom bar: frame description (trace) | error | hint */}
      {trace ? (
        <div className={`px-4 py-2.5 border-t text-xs font-mono leading-relaxed flex-shrink-0 ${
          isCrash
            ? 'border-red-500/40 bg-red-500/10 text-red-300'
            : 'border-zinc-800/60 bg-zinc-900/40 text-zinc-400'
        }`}>
          {isCrash && <span className="text-red-400 font-semibold mr-1.5">CRASH</span>}
          {frame?.description ?? 'Step through with → or press Space to play.'}
        </div>
      ) : error ? (
        <div className="border-t border-red-500/40 bg-[#110a0a] flex-shrink-0">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-red-500/20">
            <span className="flex-shrink-0 w-4 h-4 rounded-full bg-red-500/20 border border-red-500/50 flex items-center justify-center text-[9px] text-red-400 font-bold">!</span>
            <span className="text-[10px] font-mono font-semibold text-red-400 uppercase tracking-wider">{errorType}</span>
            {errorLine && (
              <span className="ml-auto text-[10px] font-mono text-red-500/70 border border-red-500/30 px-1.5 py-0.5 rounded bg-red-500/10">
                line {errorLine}
              </span>
            )}
          </div>
          <div className="px-3 py-2.5 max-h-32 overflow-y-auto">
            <pre className="text-[10px] font-mono text-red-300/90 whitespace-pre-wrap leading-relaxed">{error}</pre>
          </div>
        </div>
      ) : (
        <div className="px-3 py-2 border-t border-zinc-800/60 bg-zinc-900/30 text-[10px] font-mono text-zinc-600 flex-shrink-0">
          ⌘ Enter to run  ·  main() required  ·  cin reads from stdin panel  ·  supports: vector, map, set, DP
        </div>
      )}
    </div>
  );
}

export default function CodePanel() {
  return <EditorMode />;
}
