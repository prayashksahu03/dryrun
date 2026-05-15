import { create } from 'zustand';
import { Trace, TraceStep } from '../types/trace';
import { Ambiguity, VizHint } from '../types/ambiguity';
import { detectAmbiguities } from '../utils/detectAmbiguities';
import { danglingPointerTrace } from '../data/danglingPointer';
import { factorialTrace } from '../data/factorial';
import { GuidedProgram } from '../data/guided';

const BACKEND = 'http://localhost:8000';

const DEMOS: Trace[] = [danglingPointerTrace, factorialTrace];

export type Language = 'c' | 'cpp' | 'python';

export type PanelKey = 'stack' | 'heap' | 'callTree' | 'eventLog';

export const PANEL_LABELS: Record<PanelKey, string> = {
  stack:    'Stack',
  heap:     'Heap',
  callTree: 'Call Tree',
  eventLog: 'Event Log',
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
  language: 'c' as Language,
  panels: { stack: true, heap: true, callTree: true, eventLog: true },
  activeGuidedProgram: null,
  ambiguities: [],
  vizHints: {},
  setVizHints: (hints) => set({ vizHints: hints }),

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
          ? 'Cannot reach backend.\nRun in a new terminal:\n  cd ~/memtrace-backend\n  pip install -r requirements.txt\n  uvicorn main:app --reload'
          : msg,
      });
    }
  },
}));
