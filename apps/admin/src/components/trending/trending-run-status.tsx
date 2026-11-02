"use client";

import { useState } from "react";
import { Button, Chip } from "@chartermission/ui";

/** "Last run" chip with a manual recompute trigger (Figma node 20:3590). */
export function TrendingRunStatus({ initialLastRun }: { initialLastRun: string }) {
  const [lastRun, setLastRun] = useState(initialLastRun);
  const [running, setRunning] = useState(false);

  function recompute() {
    setRunning(true);
    // No backend yet: simulate the job finishing.
    window.setTimeout(() => {
      setLastRun("just now");
      setRunning(false);
    }, 1200);
  }

  return (
    <>
      <p role="status" aria-live="polite">
        <Chip tone={running ? "info" : "success"}>{running ? "Recomputing…" : `Last run ${lastRun}`}</Chip>
      </p>
      <Button variant="secondary" size="small" onClick={recompute} disabled={running} aria-busy={running}>
        Recompute now
      </Button>
    </>
  );
}
