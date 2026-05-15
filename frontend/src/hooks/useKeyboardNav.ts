import { useEffect } from 'react';
import { useExecutionStore } from '../store/executionStore';

export function useKeyboardNav() {
  const { stepForward, stepBackward, play, pause, reset, isPlaying } = useExecutionStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
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
