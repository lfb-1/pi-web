import type { VoiceInputLanguage } from "./voiceInput";

const storageKey = "pi-web:voice-input-language";

function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function loadVoiceInputLanguage(storage = browserStorage()): VoiceInputLanguage {
  try {
    const saved = storage?.getItem(storageKey);
    return saved === "zh-CN" || saved === "en-US" ? saved : "zh-CN";
  } catch {
    return "zh-CN";
  }
}

export function saveVoiceInputLanguage(language: VoiceInputLanguage, storage = browserStorage()): void {
  try {
    storage?.setItem(storageKey, language);
  } catch {
    // Ignore localStorage quota/privacy errors.
  }
}
