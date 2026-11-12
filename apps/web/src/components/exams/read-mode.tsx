"use client";

import { useEffect, useState } from "react";
import { EXAM_LANGUAGE_NAMES, type ExamLanguage } from "@chartermission/contracts";
import { SegmentedControl } from "@chartermission/ui";
import { useT } from "@/i18n/client";
import { READ_MODE_KEY, type ReadMode } from "./format";

const MODES: ReadMode[] = ["both", "first", "second"];

/** The member's reading choice for two-language exams, remembered on this device. */
export function useReadMode(): [ReadMode, (mode: ReadMode) => void] {
  const [mode, setMode] = useState<ReadMode>("both");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(READ_MODE_KEY) as ReadMode | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after hydration; the server render can't know it
      if (saved && MODES.includes(saved)) setMode(saved);
    } catch {
      /* private browsing: keep the default */
    }
  }, []);
  const choose = (next: ReadMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(READ_MODE_KEY, next);
    } catch {
      /* not remembered, still applied */
    }
  };
  return [mode, choose];
}

/** "Both · English · العربية" switch for a two-language exam. */
export function ReadModeSwitch({ language, secondLanguage, mode, onChange }: { language: ExamLanguage; secondLanguage: ExamLanguage; mode: ReadMode; onChange: (mode: ReadMode) => void }) {
  const t = useT();
  return (
    <SegmentedControl<ReadMode>
      size="small"
      label={t("Reading language")}
      value={mode}
      onChange={onChange}
      items={[
        { value: "both", label: t("Both") },
        { value: "first", label: EXAM_LANGUAGE_NAMES[language] },
        { value: "second", label: EXAM_LANGUAGE_NAMES[secondLanguage] },
      ]}
    />
  );
}
