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
  // Whole-program signal for "what went wrong / why did it crash" questions:
  // crashes, warnings (one per kind), and the final step (end/truncation) — these
  // often live far from the current step's window but are exactly what diagnoses
  // a bug. Deduped by warning kind and capped so the payload stays small.
  const notable: typeof window = [];
  const seenKind = new Set<string>();
  for (const s of trace.steps) {
    const t = s.event.type;
    if (t === 'crash' || t === 'warning') {
      const k = t + ':' + ((s.event as { kind?: string }).kind ?? '');
      if (!seenKind.has(k)) {
        seenKind.add(k);
        notable.push({ index: s.index, line: s.line, description: s.description, event: s.event });
      }
    }
    if (notable.length >= 10) break;
  }
  const lastStep = trace.steps[trace.steps.length - 1];
  if (lastStep && !notable.some(n => n.index === lastStep.index)) {
    notable.push({ index: lastStep.index, line: lastStep.line, description: lastStep.description, event: lastStep.event });
  }
  const res = await fetch(`${BACKEND}/explain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: trace.source, current_step: step, mode,
      question: question ?? null, window, snapshot, notable,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `Server error ${res.status}` }));
    throw new Error(err.detail ?? `Server error ${res.status}`);
  }
  const data = await res.json();
  return data.explanation as string;
}

// A tutor "beat": a key step the LLM chose to teach, with grounded narration.
export interface Beat {
  step: number;
  title: string;
  narration: string;
}

// Build a compacted whole-trace digest and ask the backend for a guided
// walkthrough (the LLM picks the key step indices + narration). Large traces are
// sampled so the payload/latency stay bounded; the returned step indices are
// still real, so goToStep() can drive the animation to each beat.
async function postWalkthrough(trace: Trace, question?: string): Promise<Beat[]> {
  const steps = trace.steps;
  const map = (s: TraceStep) => ({
    index: s.index, line: s.line, description: s.description, event: s.event,
  });
  let digest: ReturnType<typeof map>[];
  if (steps.length <= 160) {
    digest = steps.map(map);
  } else {
    const k = Math.ceil(steps.length / 140);
    digest = steps.filter((_, i) => i % k === 0 || i === steps.length - 1).map(map);
  }
  const notable: ReturnType<typeof map>[] = [];
  const seenKind = new Set<string>();
  for (const s of steps) {
    const t = s.event.type;
    if (t === 'crash' || t === 'warning') {
      const kk = t + ':' + ((s.event as { kind?: string }).kind ?? '');
      if (!seenKind.has(kk)) { seenKind.add(kk); notable.push(map(s)); }
    }
    if (notable.length >= 10) break;
  }
  const last = steps[steps.length - 1];
  if (last && !notable.some(n => n.index === last.index)) notable.push(map(last));

  const res = await fetch(`${BACKEND}/walkthrough`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: trace.source, digest, notable, total_steps: steps.length,
      question: question ?? null,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `Server error ${res.status}` }));
    throw new Error(err.detail ?? `Server error ${res.status}`);
  }
  const data = await res.json();
  return data.beats as Beat[];
}

export type Language = 'c' | 'cpp' | 'python';

// Top-level view. Debug = memory/animation; Tutor = AI explainer; Interview = mock interviewer.
export type AppMode = 'debug' | 'tutor' | 'interview';

// Views bar now governs ONLY the memory panels — the AI features are top-level modes.
export type PanelKey = 'stack' | 'heap' | 'callTree' | 'eventLog';

export const PANEL_LABELS: Record<PanelKey, string> = {
  stack:     'Stack',
  heap:      'Heap',
  callTree:  'Call Tree',
  eventLog:  'Event Log',
};

// One message in the Tutor conversation. A message with a `step` is clickable and
// drives the animation (goToStep) — walkthrough beats and per-step explains carry one.
export interface TutorMsg {
  id: number;
  role: 'you' | 'tutor';
  text: string;
  step?: number;
}
let _tutorMsgId = 0;
const nextTutorMsgId = () => ++_tutorMsgId;

// A turn in the interview transcript.
export interface InterviewTurn {
  role: 'interviewer' | 'candidate';
  content: string;
}

// Compact, grounded summary of what the code did — gives the interviewer real
// behavior to probe and to check answers against.
function buildInterviewSummary(trace: Trace): string {
  const steps = trace.steps;
  const parts: string[] = [];
  const output = steps
    .filter(s => s.event.type === 'output')
    .map(s => (s.event as { type: 'output'; text: string }).text)
    .join('');
  if (output.trim()) parts.push(`Program output: ${JSON.stringify(output.trim())}`);

  const algo = steps.map(s => s.execution?.algorithm).find(Boolean);
  if (algo) parts.push(`Detected pattern: ${algo}`);
  const g = steps.map(s => s.graph).find(Boolean);
  if (g) parts.push(`Graph: ${g.nodes.length} nodes, ${g.edges.length} edges, ${g.directed ? 'directed' : 'undirected'}`);
  const grid = steps.map(s => s.grid).find(Boolean);
  if (grid) parts.push(`Grid: ${grid.rows}x${grid.cols}`);

  const warns = new Set<string>();
  for (const s of steps) {
    if (s.event.type === 'warning' || s.event.type === 'crash') {
      warns.add(`${s.event.type}: ${(s.event as { kind?: string; message?: string }).message ?? (s.event as { kind?: string }).kind ?? ''}`);
    }
  }
  if (warns.size) parts.push(`Runtime notes: ${[...warns].slice(0, 4).join('; ')}`);
  parts.push(`Executed in ${steps.length} trace steps.`);
  return parts.join('\n');
}

async function postInterview(trace: Trace, history: InterviewTurn[]): Promise<string> {
  const res = await fetch(`${BACKEND}/interview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: trace.source, summary: buildInterviewSummary(trace), history }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `Server error ${res.status}` }));
    throw new Error(err.detail ?? `Server error ${res.status}`);
  }
  const data = await res.json();
  return data.message as string;
}

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

  // Top-level mode: which experience fills the main area.
  appMode: AppMode;
  setAppMode: (mode: AppMode) => void;

  activeGuidedProgram: GuidedProgram | null;

  ambiguities: Ambiguity[];
  vizHints: Record<string, VizHint>;
  setVizHints: (hints: Record<string, VizHint>) => void;

  // Tutor (grounded LLM narration). One running conversation: per-step explains,
  // free-text Q&A, and walkthrough beats all land in `tutorTranscript` as messages.
  tutorTranscript: TutorMsg[];
  explanationCache: Record<string, string>;
  explainLoading: boolean;
  explainError: string | null;
  walkLoading: boolean;
  walkError: string | null;
  explainStep: (step: number) => Promise<void>;
  askQuestion: (q: string) => Promise<void>;
  startWalkthrough: (question?: string) => Promise<void>;

  // Interview mode: LLM interviewer asks about the candidate's code, one Q at a time
  interview: { history: InterviewTurn[] } | null;
  interviewLoading: boolean;
  interviewError: string | null;
  startInterview: () => Promise<void>;
  answerInterview: (answer: string) => Promise<void>;
  endInterview: () => void;

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
  panels: { stack: true, heap: true, callTree: true, eventLog: true },
  appMode: 'debug',
  setAppMode: (mode) => set({ appMode: mode }),
  activeGuidedProgram: null,
  ambiguities: [],
  vizHints: {},
  setVizHints: (hints) => set({ vizHints: hints }),

  tutorTranscript: [],
  explanationCache: {},
  explainLoading: false,
  explainError: null,
  walkLoading: false,
  walkError: null,

  interview: null,
  interviewLoading: false,
  interviewError: null,

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

  setEditorSource: (src) => set({
    editorSource: src, error: null, activeGuidedProgram: null,
    tutorTranscript: [], walkError: null, explainError: null,
    interview: null, interviewError: null,
  }),
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
      set({
        trace, currentStep: 0, isPlaying: false, isLoading: false, error: null, ambiguities, vizHints: {},
        // A new program invalidates every explanation/walkthrough — messages point
        // at the OLD trace's step indices, so they must be cleared, not carried over.
        tutorTranscript: [], walkLoading: false, walkError: null,
        explanationCache: {}, explainLoading: false, explainError: null,
        interview: null, interviewLoading: false, interviewError: null,
      });
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

  // Append a grounded explanation of `step` to the tutor conversation. Cached so
  // re-explaining a step never re-calls the LLM. The message carries `step`, so
  // clicking it later re-drives the animation there.
  explainStep: async (step) => {
    const { trace } = get();
    if (!trace) return;
    const key = `${step}:step:`;
    const cached = get().explanationCache[key];
    if (cached) {
      set(s => ({
        explainError: null,
        tutorTranscript: [...s.tutorTranscript, { id: nextTutorMsgId(), role: 'tutor', text: cached, step }],
      }));
      return;
    }
    set({ explainLoading: true, explainError: null });
    try {
      const text = await postExplain(trace, step, 'step');
      set(s => ({
        explainLoading: false,
        explanationCache: { ...s.explanationCache, [key]: text },
        tutorTranscript: [...s.tutorTranscript, { id: nextTutorMsgId(), role: 'tutor', text, step }],
      }));
    } catch (e) {
      set({ explainLoading: false, explainError: e instanceof Error ? e.message : String(e) });
    }
  },

  // Free-text Q&A about the program, grounded in the trace. Appends your question,
  // then the tutor's answer.
  askQuestion: async (q) => {
    const { trace, currentStep } = get();
    if (!trace || !q.trim()) return;
    set(s => ({
      explainLoading: true, explainError: null,
      tutorTranscript: [...s.tutorTranscript, { id: nextTutorMsgId(), role: 'you', text: q.trim() }],
    }));
    try {
      const text = await postExplain(trace, currentStep, 'question', q.trim());
      set(s => ({
        explainLoading: false,
        tutorTranscript: [...s.tutorTranscript, { id: nextTutorMsgId(), role: 'tutor', text }],
      }));
    } catch (e) {
      set({ explainLoading: false, explainError: e instanceof Error ? e.message : String(e) });
    }
  },

  // Guided tour: the LLM picks key steps ("beats"); each becomes a clickable tutor
  // message that drives the animation. With a `question`, the beats are scoped to it.
  startWalkthrough: async (question?: string) => {
    const { trace } = get();
    if (!trace) return;
    const q = question?.trim();
    if (q) {
      set(s => ({ tutorTranscript: [...s.tutorTranscript, { id: nextTutorMsgId(), role: 'you', text: q }] }));
    }
    set({ walkLoading: true, walkError: null });
    try {
      const beats = await postWalkthrough(trace, q || undefined);
      const msgs: TutorMsg[] = beats.map(b => ({
        id: nextTutorMsgId(), role: 'tutor', text: `${b.title} — ${b.narration}`, step: b.step,
      }));
      set(s => ({ walkLoading: false, tutorTranscript: [...s.tutorTranscript, ...msgs] }));
      if (beats.length) get().goToStep(beats[0].step);
    } catch (e) {
      set({ walkLoading: false, walkError: e instanceof Error ? e.message : String(e) });
    }
  },

  // Interview: the LLM interviewer opens with a question about the candidate's code.
  startInterview: async () => {
    const { trace } = get();
    if (!trace) return;
    set({ interviewLoading: true, interviewError: null, interview: { history: [] } });
    try {
      const msg = await postInterview(trace, []);
      set({ interviewLoading: false, interview: { history: [{ role: 'interviewer', content: msg }] } });
    } catch (e) {
      set({ interviewLoading: false, interview: null, interviewError: e instanceof Error ? e.message : String(e) });
    }
  },

  // Candidate answers → interviewer gives feedback + the next question.
  answerInterview: async (answer) => {
    const { trace, interview } = get();
    if (!trace || !interview || !answer.trim()) return;
    const history: InterviewTurn[] = [...interview.history, { role: 'candidate', content: answer.trim() }];
    set({ interviewLoading: true, interviewError: null, interview: { history } });
    try {
      const msg = await postInterview(trace, history);
      set({
        interviewLoading: false,
        interview: { history: [...history, { role: 'interviewer', content: msg }] },
      });
    } catch (e) {
      set({ interviewLoading: false, interviewError: e instanceof Error ? e.message : String(e) });
    }
  },

  endInterview: () => set({ interview: null, interviewError: null }),
}));
