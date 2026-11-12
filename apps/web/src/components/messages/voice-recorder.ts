"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VOICE_NOTE_MAX_SECONDS } from "@chartermission/contracts";

/** Formats the browser can record, best first (Chrome/Firefox WebM Opus; Safari MP4 AAC). */
const FORMATS = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];

export type VoiceRecorder = {
  state: "idle" | "recording" | "ready";
  seconds: number;
  /** 0–1 microphone level while recording, for the meter. */
  level: number;
  file: File | null;
  error: string | null;
  supported: boolean;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
};

/** Records a voice note with the microphone; stops by itself at VOICE_NOTE_MAX_SECONDS. */
export function useVoiceRecorder(): VoiceRecorder {
  const [state, setState] = useState<VoiceRecorder["state"]>("idle");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);
  const started = useRef(0);
  const discard = useRef(false);
  const audio = useRef<{ context: AudioContext; frame: number } | null>(null);
  const supported = typeof window !== "undefined" && "MediaRecorder" in window && !!navigator.mediaDevices?.getUserMedia;

  const cleanup = useCallback(() => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (audio.current) {
      cancelAnimationFrame(audio.current.frame);
      void audio.current.context.close().catch(() => undefined);
      audio.current = null;
    }
    setLevel(0);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const stop = useCallback(() => {
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setFile(null);
    if (!supported) {
      setError("This browser can’t record audio.");
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      stream.current = media;
      const mimeType = FORMATS.find((f) => MediaRecorder.isTypeSupported(f));
      const rec = new MediaRecorder(media, mimeType ? { mimeType, audioBitsPerSecond: 48_000 } : undefined);
      recorder.current = rec;
      chunks.current = [];
      discard.current = false;
      rec.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      rec.onstop = () => {
        const type = (rec.mimeType || mimeType || "audio/webm").split(";")[0]!;
        cleanup();
        if (discard.current || !chunks.current.length) {
          setState("idle");
          setSeconds(0);
          return;
        }
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        setFile(new File(chunks.current, `voice-message.${ext}`, { type }));
        setState("ready");
      };
      rec.start(1000);
      started.current = Date.now();
      setSeconds(0);
      setState("recording");
      timer.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - started.current) / 1000);
        setSeconds(elapsed);
        if (elapsed >= VOICE_NOTE_MAX_SECONDS) stop();
      }, 250);
      // A simple level meter so the member can see the microphone is picking them up.
      try {
        const context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        context.createMediaStreamSource(media).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
          setLevel(Math.min(1, peak / 64));
          if (audio.current) audio.current.frame = requestAnimationFrame(tick);
        };
        audio.current = { context, frame: requestAnimationFrame(tick) };
      } catch {
        // No meter; recording still works.
      }
    } catch (e) {
      cleanup();
      setState("idle");
      setError(
        (e as DOMException)?.name === "NotAllowedError"
          ? "Allow the microphone for Charter Mission in your browser to record a voice message."
          : "Your microphone couldn’t be started.",
      );
    }
  }, [cleanup, stop, supported]);

  const cancel = useCallback(() => {
    discard.current = true;
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    else {
      cleanup();
      setState("idle");
    }
    setFile(null);
    setSeconds(0);
  }, [cleanup]);

  return { state, seconds, level, file, error, supported, start, stop, cancel };
}
