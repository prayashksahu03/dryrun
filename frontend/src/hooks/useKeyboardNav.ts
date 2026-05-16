import { useEffect } from 'react';
import { useExecutionStore } from '../store/executionStore';

export function useKeyboardNav() {
  const { stepForward, stepBackward, play, pause, reset, isPlaying } = useExecutionStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (t.isContentEditable) return;
      switch (e.key) {
        case 'ArrowRight': case 'l': e.preventDefault(); stepForward(); break;
        case 'ArrowLeft':  case 'h': e.preventDefault(); stepBackward(); break;
        case ' ':                    e.preventDefault(); isPlaying ? pause() : play(); break;
        case '0':                    e.preventDefault(); reset(); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isPlaying, stepForward, stepBackward, play, pause, reset]);
}
