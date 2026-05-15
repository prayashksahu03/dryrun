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

const DEFAULT_PY = `def knapsack(weights, values, cap):
    n = len(weights)
    dp = [[0] * (cap + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        for w in range(cap + 1):
            dp[i][w] = dp[i-1][w]
            if weights[i-1] <= w:
                take = dp[i-1][w - weights[i-1]] + values[i-1]
                if take > dp[i][w]:
                    dp[i][w] = take
    return dp[n][cap]

weights = [1, 3, 4, 5]
values  = [1, 4, 5, 7]
result  = knapsack(weights, values, 7)
`;

function LangPill({ lang }: { lang: Language }) {
  const { language, setLanguage, setEditorSource, editorSource } = useExecutionStore();
  const active = language === lang;

  const handleClick = () => {
    if (active) return;
    setLanguage(lang);
    // Switch to a default template only when the editor still has the other language's default
    if (lang === 'cpp' && editorSource !== DEFAULT_CPP) setEditorSource(DEFAULT_CPP);
    if (lang === 'python' && editorSource !== DEFAULT_PY) setEditorSource(DEFAULT_PY);
  };

  return (
    <button
      onClick={handleClick}
      className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium transition-all ${
        active
          ? 'bg-violet-500/30 text-violet-300 border border-violet-500/50'
          : 'text-zinc-600 hover:text-zinc-400 border border-transparent hover:border-zinc-700'
      }`}
    >
      {LANG_LABELS[lang]}
    </button>
  );
}

// ── Editor mode ───────────────────────────────────────────────────────

function EditorMode() {
  const { editorSource, setEditorSource, stdinInput, setStdinInput, runCode, isLoading, error, loadDemo, demoIndex, language } =
    useExecutionStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [stdinOpen, setStdinOpen] = useState(true);
  const errorLine   = error ? parseErrorLine(error) : null;
  const errorType   = error ? parseErrorType(error) : null;
  const DEMO_LABELS = ['dangling ptr', 'recursion'];
  const nextDemoLabel = DEMO_LABELS[(demoIndex + 1) % DEMO_LABELS.length];

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
      const indent = language === 'python' ? '    ' : '    ';
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
        <div className="flex items-center gap-1">
          {(['cpp', 'python'] as Language[]).map(l => (
            <LangPill key={l} lang={l} />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadDemo}
            className="text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors px-1.5 py-0.5 rounded hover:bg-zinc-800"
            title={`Load next demo: ${nextDemoLabel}`}
          >
            demo: {nextDemoLabel}
          </button>
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
          className="flex-shrink-0 w-10 text-right py-3 pr-2 text-xs font-mono leading-relaxed select-none overflow-hidden bg-[#0d0d0f] pointer-events-none"
          aria-hidden
        >
          {lines.map((_, i) => {
            const ln = i + 1;
            const isErr = errorLine === ln;
            return (
              <div key={i} className={`leading-[1.6rem] pr-1 ${isErr ? 'text-red-400' : 'text-zinc-700'}`}>
                {isErr ? '✕' : ln}
              </div>
            );
          })}
        </div>

        {/* Error stripe */}
        {errorLine && errorLine <= lines.length && (
          <div
            className="absolute pointer-events-none"
            style={{
              top: `calc(0.75rem + ${(errorLine - 1) * 1.6}rem)`,
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
          onChange={e => setEditorSource(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          className="flex-1 bg-transparent text-zinc-300 text-xs font-mono leading-[1.6rem] py-3 pr-4 resize-none outline-none border-none relative z-10"
          style={{ caretColor: '#c084fc' }}
          placeholder={`Write your ${LANG_LABELS[language]} code here...`}
        />
      </div>

      {/* stdin panel — C/C++ only */}
      {(language === 'cpp' || language === 'c') && (
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

      {/* Error / hint bar */}
      {error ? (
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
          {language === 'python'
            ? '⌘ Enter to run  ·  supports: lists, 2D arrays, recursion, loops'
            : language === 'cpp'
            ? '⌘ Enter to run  ·  main() required  ·  cin reads from stdin panel  ·  supports: vector, map, set, DP'
            : '⌘ Enter to run  ·  supports: malloc, free, structs, pointers, if/while/for'}
        </div>
      )}
    </div>
  );
}

// ── Debug mode (trace loaded) ─────────────────────────────────────────

function DebugMode() {
  const { trace, currentFrame, clearTrace, language } = useExecutionStore();
  const frame       = currentFrame();
  const currentLine = frame?.line ?? -1;
  const isCrash     = frame?.event.type === 'crash';
  const lines       = (trace?.source ?? '').split('\n');
  const scrollRef   = useRef<HTMLDivElement>(null);
  const activeRef   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeRef.current && scrollRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [currentLine]);

  return (
    <div data-tour="code-editor" className="flex flex-col border-r border-zinc-800/60 overflow-hidden bg-[#0d0d0f] h-full w-full">
      <div data-tour="code-toolbar" className="flex items-center justify-between px-3 h-9 border-b border-zinc-800/60 bg-[#111113]">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
          <span className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
          <span className="ml-2 text-xs text-zinc-500 font-mono">{LANG_FILE[language]}</span>
        </div>
        <button
          onClick={clearTrace}
          className="text-[10px] font-mono text-zinc-600 hover:text-violet-400 transition-colors px-2 py-0.5 rounded hover:bg-zinc-800 border border-transparent hover:border-zinc-700"
        >
          ← edit code
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto py-2">
        {lines.map((line, i) => {
          const ln        = i + 1;
          const isActive  = ln === currentLine;
          const isCrashLn = isCrash && isActive;

          return (
            <div
              key={i}
              ref={isActive ? activeRef : undefined}
              className={`flex items-stretch min-h-[1.6rem] transition-colors duration-100 ${
                isCrashLn ? 'bg-red-500/15' : isActive ? 'bg-amber-500/10' : ''
              }`}
            >
              <div className={`w-10 flex-shrink-0 text-right pr-3 pt-0.5 text-xs select-none font-mono ${
                isActive ? (isCrashLn ? 'text-red-400' : 'text-amber-400') : 'text-zinc-700'
              }`}>
                {ln}
              </div>
              <div className="w-4 flex-shrink-0 flex items-center justify-center">
                {isCrashLn && <span className="text-red-400 text-xs leading-none">✕</span>}
                {isActive && !isCrashLn && <span className="text-amber-400 text-xs leading-none">▶</span>}
              </div>
              <div
                className={`flex-1 pr-4 pt-0.5 text-xs font-mono leading-relaxed whitespace-pre ${
                  isCrashLn ? 'text-red-300' : isActive ? 'text-zinc-100' : 'text-zinc-400'
                }`}
                dangerouslySetInnerHTML={{ __html: highlight(line, language) || ' ' }}
              />
            </div>
          );
        })}
      </div>

      <div className={`px-4 py-2.5 border-t text-xs font-mono leading-relaxed flex-shrink-0 ${
        isCrash
          ? 'border-red-500/40 bg-red-500/10 text-red-300'
          : 'border-zinc-800/60 bg-zinc-900/40 text-zinc-400'
      }`}>
        {isCrash && <span className="text-red-400 font-semibold mr-1.5">CRASH</span>}
        {frame?.description ?? 'Step through with → or press Space to play.'}
      </div>
    </div>
  );
}

// ── Export ────────────────────────────────────────────────────────────

export default function CodePanel() {
  const { trace } = useExecutionStore();
  return trace ? <DebugMode /> : <EditorMode />;
}
