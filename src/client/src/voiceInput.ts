export type VoiceInputLanguage = "zh-CN" | "en-US";

export interface SpeechRecognitionAlternativeLike {
  readonly transcript: string;
}

export interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResultLike;
}

export interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

export interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
  readonly message?: string;
}

export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: ((event: Event) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: ((event: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechRecognitionConstructorLike = new () => SpeechRecognitionLike;

export interface SpeechRecognitionHost {
  readonly SpeechRecognition?: SpeechRecognitionConstructorLike;
  readonly webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
  readonly isSecureContext?: boolean;
}

export interface VoiceRecognitionTranscripts {
  readonly final: string;
  readonly interim: string;
}

export interface VoiceTranscriptInsertion {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
  readonly cursor: number;
}

export function browserSpeechRecognitionConstructor(target: SpeechRecognitionHost | undefined = browserWindow()): SpeechRecognitionConstructorLike | undefined {
  return target?.SpeechRecognition ?? target?.webkitSpeechRecognition;
}

export function browserIsSecureContext(target: SpeechRecognitionHost | undefined = browserWindow()): boolean {
  return target?.isSecureContext === true;
}

export function recognitionTranscripts(event: SpeechRecognitionEventLike, language: VoiceInputLanguage): VoiceRecognitionTranscripts {
  const final: string[] = [];
  const interim: string[] = [];
  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    if (result === undefined) continue;
    const transcript = result[0]?.transcript.trim();
    if (transcript === undefined || transcript === "") continue;
    (result.isFinal ? final : interim).push(transcript);
  }
  const separator = language === "zh-CN" ? "" : " ";
  return { final: final.join(separator), interim: interim.join(separator) };
}

export function voiceTranscriptInsertion(draft: string, from: number, to: number, transcript: string, language: VoiceInputLanguage): VoiceTranscriptInsertion | undefined {
  const normalized = transcript.trim();
  if (normalized === "") return undefined;
  const safeFrom = Math.max(0, Math.min(from, draft.length));
  const safeTo = Math.max(safeFrom, Math.min(to, draft.length));
  const left = draft.slice(0, safeFrom);
  const right = draft.slice(safeTo);
  const prefix = language === "en-US" && needsEnglishBoundarySpace(left[left.length - 1], normalized[0], "before") ? " " : "";
  const suffix = language === "en-US" && needsEnglishBoundarySpace(normalized[normalized.length - 1], right[0], "after") ? " " : "";
  const insert = `${prefix}${normalized}${suffix}`;
  return { from: safeFrom, to: safeTo, insert, cursor: safeFrom + insert.length };
}

export function voiceRecognitionErrorMessage(error: string, secureContext: boolean): string | undefined {
  switch (error) {
    case "aborted":
      return undefined;
    case "no-speech":
      return "No speech was detected. Select the expected language and try again.";
    case "audio-capture":
      return "Chrome could not access a microphone. Check the selected input device and operating-system permissions.";
    case "not-allowed":
    case "service-not-allowed":
      return secureContext
        ? "Microphone or speech-recognition access was denied. Allow microphone access for this site and try again."
        : "Chrome denied microphone access on this HTTP address. Open Pi Web over HTTPS or localhost, allow microphone access, and try again.";
    case "network":
      return "Chrome could not reach its speech-recognition service. Check the network connection and try again.";
    case "language-not-supported":
      return "Chrome does not support the selected recognition language on this device.";
    default:
      return "Voice input stopped because speech recognition failed. Try again or use keyboard input.";
  }
}

function browserWindow(): SpeechRecognitionHost | undefined {
  return typeof window === "undefined" ? undefined : window;
}

function needsEnglishBoundarySpace(left: string | undefined, right: string | undefined, side: "before" | "after"): boolean {
  if (left === undefined || right === undefined || /\s/u.test(left) || /\s/u.test(right)) return false;
  if (side === "before") {
    if (/[([{"'“‘]/u.test(left)) return false;
    if (/[,.;:!?…\])}]/u.test(right)) return false;
    return true;
  }
  if (/[([{"'“‘]/u.test(right)) return false;
  if (/[,.;:!?…\])}]/u.test(right)) return false;
  return true;
}
