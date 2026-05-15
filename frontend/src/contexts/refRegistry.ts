import { createContext, useContext, RefObject } from 'react';

export interface RefRegistry {
  register: (key: string, el: HTMLElement | null) => void;
  getEl: (key: string) => HTMLElement | null;
  canvasRef: RefObject<HTMLDivElement>;
}

export const RefRegistryContext = createContext<RefRegistry>({
  register: () => {},
  getEl: () => null,
  canvasRef: { current: null },
});

export function useRefRegistry() {
  return useContext(RefRegistryContext);
}
