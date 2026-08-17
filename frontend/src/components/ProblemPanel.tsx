// The LeetCode-style "description" pane for /solve/:id. Read-only: renders the OA
// question — title, company, the problem statement, and the screenshot images
// (which carry the sample / trial test cases already on onlineassessments.tech).
export interface OAProblem {
  id: number;
  title: string;
  company_name: string;
  company_tag: string;
  text: string;
  images: string[];
}

export default function ProblemPanel({ problem }: { problem: OAProblem }) {
  return (
    <div className="flex flex-col h-full w-full bg-[#0d0d0f] border-r border-zinc-800/60 overflow-hidden">
      <div className="flex items-center gap-2 h-9 px-3 border-b border-zinc-800/60 flex-shrink-0">
        <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-600">Problem</span>
        {problem.company_name && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/25">
            {problem.company_name}
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        <h1 className="text-lg font-semibold text-zinc-100 mb-3 leading-snug">{problem.title}</h1>

        {problem.text?.trim() && (
          <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-zinc-300 mb-5">
            {problem.text.trim()}
          </pre>
        )}

        {problem.images?.length > 0 && (
          <div className="flex flex-col gap-3">
            {problem.images.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={`${problem.title} — figure ${i + 1}`}
                loading="lazy"
                className="max-w-full rounded-lg border border-zinc-800/70 bg-white"
              />
            ))}
          </div>
        )}

        {!problem.text?.trim() && problem.images?.length === 0 && (
          <p className="text-zinc-500 text-sm font-mono">No problem content available.</p>
        )}
      </div>
    </div>
  );
}
