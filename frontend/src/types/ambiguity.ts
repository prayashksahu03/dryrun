export type AmbiguityKind =
  | 'matrix_or_graph'    // square 2D array with non-negative values
  | 'struct_or_segtree'  // struct with array field(s) — unclear if seg tree
  | 'pair_field_order'   // adj list of pairs — which field is node vs weight
  | 'array_unknown'      // standalone 1D array — might be segtree, BIT, etc.
  | 'array_or_dsu';      // 1D int array where all values in [0,n) — might be DSU parent

export interface Ambiguity {
  id: string;
  kind: AmbiguityKind;
  varName: string;
  // matrix_or_graph
  matrixSize?: number;
  // struct_or_segtree
  arrayFields?: string[];
  // pair_field_order
  samplePair?: [number, number];
  // array_unknown
  arraySize?: number;
}

export type VizHint =
  | { kind: 'graph' }
  | { kind: 'grid' }
  | { kind: 'segtree'; arrayField: string; indexBase: 0 | 1 }
  | { kind: 'segtree_flat'; indexBase: 0 | 1 }   // standalone 1D array segtree
  | { kind: 'struct' }
  | { kind: 'pair_order'; destField: 'first' | 'second' }
  | { kind: 'dsu' }
  | { kind: 'plain_array' }
  | { kind: 'skip' };
