// Loading state for /solve/:id. The layout that is about to arrive is drawn
// immediately in grey, so the fetch reads as "this is coming" rather than as a
// blank pane. Deliberately calm — a shimmer on both halves of the screen would
// be noise, so only the title and first lines pulse.

function Bar({ w, h = 10, className = '' }: { w: string; h?: number; className?: string }) {
  return <div className={`rounded bg-zinc-800/70 ${className}`} style={{ width: w, height: h }} />;
}

export function ProblemSkeleton() {
  return (
    <div className="flex flex-col h-full w-full bg-[#0d0d0f] border-r border-zinc-800/60 overflow-hidden" aria-hidden>
      <div className="flex items-center gap-2 h-9 px-3 border-b border-zinc-800/60 flex-shrink-0">
        <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-700">Problem</span>
        <Bar w="72px" h={14} className="animate-pulse" />
      </div>
      <div className="flex-1 px-5 py-4 flex flex-col gap-3">
        <Bar w="62%" h={20} className="animate-pulse" />
        <div className="flex gap-1.5">
          <Bar w="58px" h={20} />
          <Bar w="74px" h={20} />
          <Bar w="66px" h={20} />
        </div>
        <div className="mt-2 flex flex-col gap-2.5">
          {['96%', '88%', '92%', '70%'].map((w, i) => <Bar key={i} w={w} />)}
        </div>
        <div className="mt-4 rounded-lg border border-zinc-800/60 h-24" />
        <div className="mt-1 flex flex-col gap-2.5">
          {['84%', '90%'].map((w, i) => <Bar key={i} w={w} />)}
        </div>
      </div>
    </div>
  );
}

export function EditorSkeleton() {
  return (
    <div className="flex flex-col h-full w-full bg-[#0d0d0f] overflow-hidden" aria-hidden>
      <div className="flex items-center gap-1.5 h-9 px-3 border-b border-zinc-800/60 bg-[#111113] flex-shrink-0">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500/30" />
        <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/30" />
        <span className="w-2.5 h-2.5 rounded-full bg-green-500/30" />
        <Bar w="60px" h={10} className="ml-2" />
      </div>
      <div className="flex-1 p-4 flex flex-col gap-2.5">
        {['38%', '64%', '52%', '71%', '44%', '58%', '30%'].map((w, i) => (
          <Bar key={i} w={w} h={9} />
        ))}
      </div>
    </div>
  );
}
