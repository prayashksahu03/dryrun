import { create } from 'zustand';
import { Trace, TraceStep } from '../types/trace';
import { Ambiguity, VizHint } from '../types/ambiguity';
import { detectAmbiguities } from '../utils/detectAmbiguities';
import { danglingPointerTrace } from '../data/danglingPointer';
import { GuidedProgram } from '../data/guided';

const BACKEND = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000';

const DEMOS: Trace[] = [danglingPointerTrace];

// Build the grounding payload and POST to /explain. The LLM only ever sees a
// trimmed window (no per-step memory) plus the CURRENT step's snapshot — the
// facts it explains are the interpreter's, never computed.
async function postExplain(
  trace: Trace,
  step: number,
  mode: 'step' | 'question',
  question?: string,
): Promise<string> {
  const lo = Math.max(0, step - 5);
  const window = trace.steps.slice(lo, step + 1).map(s => ({
    index: s.index, line: s.line, description: s.description, event: s.event,
  }));
  const cur = trace.steps[step];
  const snapshot = {
    memory:    cur?.memory ?? null,
    execution: cur?.execution ?? null,
    graph:     cur?.graph ?? null,
    grid:      cur?.grid ?? null,
    deps:      cur?.deps ?? null,
    dsu:       cur?.dsu ?? null,
  };
  const res = await fetch(`${BACKEND}/explain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: trace.source, current_step: step, mode,
      question: question ?? null, window, snapshot,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `Server error ${res.status}` }));
    throw new Error(err.detail ?? `Server error ${res.status}`);
  }
  const data = await res.json();
  return data.explanation as string;
}

export type Language = 'c' | 'cpp' | 'python';

export type PanelKey = 'stack' | 'heap' | 'callTree' | 'eventLog' | 'explain';

export const PANEL_LABELS: Record<PanelKey, string> = {
  stack:    'Stack',
  heap:     'Heap',
  callTree: 'Call Tree',
  eventLog: 'Event Log',
  explain:  'Explain',
};

interface ExecutionStore {
  trace: Trace | null;
  currentStep: number;
  isPlaying: boolean;
  playbackSpeed: number;

  editorSource: string;
  stdinInput: string;
  isLoading: boolean;
  error: string | null;
  demoIndex: number;
  language: Language;

  panels: Record<PanelKey, boolean>;

  activeGuidedProgram: GuidedProgram | null;

  ambiguities: Ambiguity[];
  vizHints: Record<string, VizHint>;
  setVizHints: (hints: Record<string, VizHint>) => void;

  // Explain tutor (grounded LLM narration — never in the execution path)
  explanationCache: Record<string, string>;
  explainLoading: boolean;
  explainError: string | null;
  currentExplanation: string | null;
  qa: { q: string; a: string } | null;
  explainStep: (step: number) => Promise<void>;
  askQuestion: (q: string) => Promise<void>;

  currentFrame: () => TraceStep | null;
  prevFrame: () => TraceStep | null;

  stepForward: () => void;
  stepBackward: () => void;
  jumpToNextEvent: () => void;
  jumpToPrevEvent: () => void;
  jumpToCrash: () => void;
  goToStep: (n: number) => void;
  play: () => void;
  pause: () => void;
  reset: () => void;
  setSpeed: (speed: number) => void;

  setEditorSource: (src: string) => void;
  setStdinInput: (input: string) => void;
  setLanguage: (lang: Language) => void;
  togglePanel: (panel: PanelKey) => void;
  runCode: () => Promise<void>;
  reportIssue: (note?: string) => Promise<boolean>;
  clearTrace: () => void;
  loadDemo: () => void;
  loadGuidedProgram: (program: GuidedProgram) => Promise<void>;
}

export const useExecutionStore = create<ExecutionStore>((set, get) => ({
  trace: danglingPointerTrace,
  currentStep: 0,
  isPlaying: false,
  playbackSpeed: 1,

  editorSource: danglingPointerTrace.source,
  stdinInput: '',
  isLoading: false,
  error: null,
  demoIndex: 0,
  language: 'cpp' as Language,
  panels: { stack: true, heap: true, callTree: true, eventLog: true, explain: true },
  activeGuidedProgram: null,
  ambiguities: [],
  vizHints: {},
  setVizHints: (hints) => set({ vizHints: hints }),

  explanationCache: {},
  explainLoading: false,
  explainError: null,
  currentExplanation: null,
  qa: null,

  currentFrame: () => {
    const { trace, currentStep } = get();
    return trace ? trace.steps[currentStep] : null;
  },

  prevFrame: () => {
    const { trace, currentStep } = get();
    return trace && currentStep > 0 ? trace.steps[currentStep - 1] : null;
  },

  stepForward: () =>
    set(s => {
      if (!s.trace) return s;
      const next = Math.min(s.currentStep + 1, s.trace.steps.length - 1);
      return { currentStep: next, isPlaying: next >= s.trace.steps.length - 1 ? false : s.isPlaying };
    }),

  stepBackward: () =>
    set(s => ({ currentStep: Math.max(s.currentStep - 1, 0), isPlaying: false })),

  jumpToNextEvent: () =>
    set(s => {
      if (!s.trace) return s;
      const steps = s.trace.steps;
      const skip = new Set(['assign', 'start']);
      for (let i = s.currentStep + 1; i < steps.length; i++) {
        if (!skip.has(steps[i].event.type)) return { currentStep: i, isPlaying: false };
      }
      return { currentStep: steps.length - 1, isPlaying: false };
    }),

  jumpToPrevEvent: () =>
    set(s => {
      if (!s.trace) return s;
      const steps = s.trace.steps;
      const skip = new Set(['assign', 'start']);
      for (let i = s.currentStep - 1; i >= 0; i--) {
        if (!skip.has(steps[i].event.type)) return { currentStep: i, isPlaying: false };
      }
      return { currentStep: 0, isPlaying: false };
    }),

  jumpToCrash: () =>
    set(s => {
      if (!s.trace) return s;
      const idx = s.trace.steps.findIndex(
        step => step.event.type === 'crash' ||
          (step.event.type === 'end' && (step.event as { type: 'end'; truncated?: boolean }).truncated),
      );
      return idx >= 0 ? { currentStep: idx, isPlaying: false } : s;
    }),

  goToStep: (n) => set({ currentStep: n, isPlaying: false }),
  play:     () => set({ isPlaying: true }),
  pause:    () => set({ isPlaying: false }),
  reset:    () => set({ currentStep: 0, isPlaying: false }),
  setSpeed: (speed) => set({ playbackSpeed: speed }),

  setEditorSource: (src) => set({ editorSource: src, error: null, activeGuidedProgram: null }),
  setStdinInput: (input) => set({ stdinInput: input }),
  setLanguage: (lang) => set({ language: lang, error: null }),
  togglePanel: (panel) => set(s => ({ panels: { ...s.panels, [panel]: !s.panels[panel] } })),

  clearTrace: () =>
    set(s => ({
      trace: null,
      currentStep: 0,
      isPlaying: false,
      error: null,
      editorSource: s.trace?.source ?? s.editorSource,
    })),

  loadDemo: () =>
    set(s => {
      const next = (s.demoIndex + 1) % DEMOS.length;
      const demo = DEMOS[next];
      return {
        trace: demo,
        currentStep: 0,
        isPlaying: false,
        error: null,
        editorSource: demo.source,
        demoIndex: next,
      };
    }),

  loadGuidedProgram: async (program) => {
    set({
      activeGuidedProgram: program,
      editorSource: program.source,
      language: 'cpp',
      stdinInput: program.stdin ?? '',
      error: null,
    });
    await get().runCode();
  },

  runCode: async () => {
    const { editorSource, language, stdinInput } = get();
    if (!editorSource.trim()) return;
    set({ isLoading: true, error: null, trace: null });

    try {
      const res = await fetch(`${BACKEND}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: editorSource, language, stdin_input: stdinInput }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: `Server error ${res.status}` }));
        throw new Error(err.detail ?? `Server error ${res.status}`);
      }

      const data = await res.json();
      const trace: Trace = {
        id: 'user-program',
        name: 'Your Program',
        concept: 'custom',
        source: editorSource,
        steps: data.trace,
      };
      const ambiguities = detectAmbiguities(trace);
      set({ trace, currentStep: 0, isPlaying: false, isLoading: false, error: null, ambiguities, vizHints: {} });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      set({
        isLoading: false,
        trace: null,
        error: msg.includes('fetch') || msg.includes('Failed to fetch')
          ? 'Cannot reach backend.\nRun in a new terminal:\n  cd ~/dryrun/backend\n  pip install -r requirements.txt\n  uvicorn main:app --reload'
          : msg,
      });
    }
  },

  // Report a wrong/degraded animation. The interpreter rarely errors — it fails
  // silently — so the user's "this looks wrong" is the honest failure signal.
  reportIssue: async (note = '') => {
    const { editorSource, language } = get();
    if (!editorSource.trim()) return false;
    try {
      const res = await fetch(`${BACKEND}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: editorSource, language, note }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  // On-demand only (button click), never auto-per-step. Local cache first, so
  // re-explaining a step is instant and costs nothing.
  explainStep: async (step) => {
    const { trace } = get();
    if (!trace) return;
    const key = `${step}:step:`;
    const cached = get().explanationCache[key];
    if (cached) {
      set({ currentExplanation: cached, explainError: null, explainLoading: false });
      return;
    }
    set({ explainLoading: true, explainError: null, currentExplanation: null });
    try {
      const text = await postExplain(trace, step, 'step');
      set(s => ({
        currentExplanation: text,
        explainLoading: false,
        explanationCache: { ...s.explanationCache, [key]: text },
      }));
    } catch (e) {
      set({ explainLoading: false, explainError: e instanceof Error ? e.message : String(e) });
    }
  },

  askQuestion: async (q) => {
    const { trace, currentStep } = get();
    if (!trace || !q.trim()) return;
    const key = `${currentStep}:question:${q}`;
    const cached = get().explanationCache[key];
    if (cached) {
      set({ qa: { q, a: cached }, explainError: null, explainLoading: false });
      return;
    }
    set({ explainLoading: true, explainError: null });
    try {
      const text = await postExplain(trace, currentStep, 'question', q);
      set(s => ({
        qa: { q, a: text },
        explainLoading: false,
        explanationCache: { ...s.explanationCache, [key]: text },
      }));
    } catch (e) {
      set({ explainLoading: false, explainError: e instanceof Error ? e.message : String(e) });
    }
  },
}));
