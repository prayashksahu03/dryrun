import { motion } from 'framer-motion';
import { GridDescriptor, ExecutionDescriptor } from '../../types/trace';

// TRACE_CONTRACT_v2, slice 3 — grid as a projection, not a graph.
//
// A grid traversal keeps its 2D spatial identity: we render rows × cols of cells
// and overlay the interpreter-declared roles (current cell, frontier cells,
// visited cells). GridView performs ZERO inference — structure and roles are
// declared per step by the backend semantic-view resolver.

function isWall(v: number | string): boolean {
  if (typeof v === 'number') return v === 1;
  return v === '#' || v === '1' || v === '*';
}

// Terrain glyph shown inside a cell. Open cells stay blank so colour carries the
// traversal state; walls get a block; other chars (S/E/letters) show as-is.
function glyph(v: number | string): string {
  if (typeof v === 'string') {
    if (v === '.' || v === '0' || v === ' ' || v === '') return '';
    return v;
  }
  return '';
}

export default function GridView({
  grid,
  execution,
}: {
  grid: GridDescriptor;
  execution?: ExecutionDescriptor | null;
}) {
  const { rows, cols, cells } = grid;
  const cur = execution?.currentCell ?? null;
  const key = (r: number, c: number) => r * cols + c;
  const visitedSet  = new Set((execution?.visitedCells ?? []).map(x => key(x.r, x.c)));
  const frontierSet = new Set((execution?.frontierCells ?? []).map(x => key(x.r, x.c)));
  const algorithm = execution?.algorithm ?? null;

  const total = rows * cols;
  const CELL = total <= 64 ? 34 : total <= 150 ? 26 : total <= 256 ? 20 : 16;
  const font = CELL >= 26 ? 13 : CELL >= 20 ? 11 : 9;

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[9px] font-mono text-zinc-600 tracking-wide">
          {rows}×{cols} grid
        </span>
        {algorithm && (
          <span className="text-[8px] font-mono text-zinc-500 px-1.5 py-0.5 rounded border border-zinc-700/60 bg-zinc-800/40">
            {algorithm}
          </span>
        )}
        <div className="flex items-center gap-2 ml-auto">
          {visitedSet.size > 0 && <Legend color="rgba(34,197,94,0.7)" label="visited" />}
          {frontierSet.size > 0 && (
            <Legend color="rgba(56,189,248,0.85)" label={execution?.frontierKind === 'stack' ? 'on stack' : 'in queue'} />
          )}
          {cur && <Legend color="#fbbf24" label="active" />}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, ${CELL}px)`,
          gap: 3,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {cells.flatMap((row, r) =>
          row.map((val, c) => {
            const k = key(r, c);
            const wall      = isWall(val);
            const isCurrent = !!cur && cur.r === r && cur.c === c;
            const isFront   = frontierSet.has(k) && !isCurrent;
            const isVisited = visitedSet.has(k) && !isCurrent && !isFront;

            const bg =
              isCurrent ? 'rgba(251,191,36,0.22)' :
              isFront   ? 'rgba(56,189,248,0.20)' :
              isVisited ? 'rgba(34,197,94,0.16)' :
              wall      ? 'rgba(63,63,70,0.55)' :
              'rgba(15,15,20,0.9)';
            const border =
              isCurrent ? '#fbbf24' :
              isFront   ? 'rgba(56,189,248,0.85)' :
              isVisited ? 'rgba(34,197,94,0.5)' :
              wall      ? 'rgba(82,82,91,0.6)' :
              'rgba(39,39,42,0.9)';
            const color =
              isCurrent ? '#fbbf24' :
              isFront   ? '#7dd3fc' :
              isVisited ? '#86efac' :
              wall      ? '#71717a' :
              '#52525b';

            return (
              <motion.div
                key={`cell-${k}`}
                animate={{ backgroundColor: bg, borderColor: border, color }}
                transition={{ duration: 0.22 }}
                style={{
                  width: CELL,
                  height: CELL,
                  borderRadius: 4,
                  borderWidth: 1,
                  borderStyle: 'solid',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: font,
                  fontWeight: isCurrent ? 700 : 400,
                  userSelect: 'none',
                }}
              >
                {wall && typeof val === 'number' ? '' : glyph(val)}
              </motion.div>
            );
          }),
        )}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      <span className="text-[8px] font-mono text-zinc-700">{label}</span>
    </div>
  );
}
