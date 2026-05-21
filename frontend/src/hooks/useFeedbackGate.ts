import { useState, useCallback } from 'react';

const REMAINING_KEY = 'dryrun_runs_remaining';
const TOTAL_KEY     = 'dryrun_run_count';

function getRemaining(): number { return parseInt(localStorage.getItem(REMAINING_KEY) ?? '5', 10); }
function getTotal(): number     { return parseInt(localStorage.getItem(TOTAL_KEY) ?? '0', 10); }

export function useFeedbackGate() {
  const [gateOpen, setGateOpen] = useState(false);

  // Call before each run. Returns true if the run should proceed, false if gated.
  const attemptRun = useCallback((): boolean => {
    const remaining = getRemaining();
    if (remaining <= 0) {
      setGateOpen(true);
      return false;
    }
    localStorage.setItem(REMAINING_KEY, String(remaining - 1));
    localStorage.setItem(TOTAL_KEY, String(getTotal() + 1));
    return true;
  }, []);

  // Call when the Tally form submission is confirmed.
  const onFeedbackSubmitted = useCallback(() => {
    localStorage.setItem(REMAINING_KEY, '5');
    setGateOpen(false);
  }, []);

  return { gateOpen, attemptRun, onFeedbackSubmitted };
}
