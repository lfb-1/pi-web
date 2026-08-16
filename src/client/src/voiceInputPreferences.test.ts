import { describe, expect, it } from "vitest";
import { loadVoiceInputLanguage, saveVoiceInputLanguage } from "./voiceInputPreferences";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

class ThrowingStorage extends MemoryStorage {
  override getItem(): string | null { throw new Error("blocked"); }
  override setItem(): void { throw new Error("blocked"); }
}

describe("voice input language preference", () => {
  it("defaults to Chinese and persists either supported language", () => {
    const storage = new MemoryStorage();
    expect(loadVoiceInputLanguage(storage)).toBe("zh-CN");
    saveVoiceInputLanguage("en-US", storage);
    expect(loadVoiceInputLanguage(storage)).toBe("en-US");
    saveVoiceInputLanguage("zh-CN", storage);
    expect(loadVoiceInputLanguage(storage)).toBe("zh-CN");
  });

  it("ignores unknown or unavailable storage values", () => {
    const storage = new MemoryStorage();
    storage.setItem("pi-web:voice-input-language", "fr-FR");
    expect(loadVoiceInputLanguage(storage)).toBe("zh-CN");
    expect(loadVoiceInputLanguage(new ThrowingStorage())).toBe("zh-CN");
    expect(() => { saveVoiceInputLanguage("en-US", new ThrowingStorage()); }).not.toThrow();
  });
});
