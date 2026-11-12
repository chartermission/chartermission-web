"use client";

import { useCallback, useState } from "react";
import type { ExamAttemptView } from "@chartermission/contracts";
import { ExamResultView } from "./exam-result";
import { ExamRunner } from "./exam-runner";

/** One attempt: the exam while it is in progress, its result once it is handed in. */
export function AttemptScreen({ initial, finishProfile = false }: { initial: ExamAttemptView; finishProfile?: boolean }) {
  const [attempt, setAttempt] = useState(initial);
  const onSubmitted = useCallback((next: ExamAttemptView) => {
    setAttempt(next);
    window.scrollTo({ top: 0 });
  }, []);
  return attempt.status === "submitted" && attempt.result ? <ExamResultView attempt={attempt} finishProfile={finishProfile} /> : <ExamRunner attempt={attempt} onSubmitted={onSubmitted} />;
}
