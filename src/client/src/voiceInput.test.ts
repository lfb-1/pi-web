import { describe, expect, it, vi } from "vitest";
import {
  browserSpeechRecognitionConstructor,
  recognitionTranscripts,
  voiceRecognitionErrorMessage,
  voiceTranscriptInsertion,
  type SpeechRecognitionAlternativeLike,
  type SpeechRecognitionEventLike,
  type SpeechRecognitionLike,
  type SpeechRecognitionResultLike,
} from "./voiceInput";

class StandardRecognition implements SpeechRecognitionLike {
  continuous = false;
  interimResults = false;
  lang = "";
  maxAlternatives = 1;
  onstart: SpeechRecognitionLike["onstart"] = null;
  onresult: SpeechRecognitionLike["onresult"] = null;
  onerror: SpeechRecognitionLike["onerror"] = null;
  onend: SpeechRecognitionLike["onend"] = null;
  readonly start = vi.fn();
  readonly stop = vi.fn();
  readonly abort = vi.fn();
}

class PrefixedRecognition extends StandardRecognition {}

describe("voice input browser support", () => {
  it("prefers the standard constructor and falls back to Chrome's prefixed constructor", () => {
    expect(browserSpeechRecognitionConstructor({
      SpeechRecognition: StandardRecognition,
      webkitSpeechRecognition: PrefixedRecognition,
    })).toBe(StandardRecognition);
    expect(browserSpeechRecognitionConstructor({ webkitSpeechRecognition: PrefixedRecognition })).toBe(PrefixedRecognition);
    expect(browserSpeechRecognitionConstructor({})).toBeUndefined();
  });

  it("separates final and interim results using language-appropriate joining", () => {
    const results = new TestResultList([
      new TestResult(true, "第一句"),
      new TestResult(true, "第二句"),
      new TestResult(false, "尚未完成"),
    ]);
    const zh = recognitionTranscripts(new TestRecognitionEvent(results), "zh-CN");
    expect(zh).toEqual({ final: "第一句第二句", interim: "尚未完成" });

    results.set(0, new TestResult(true, "first phrase"));
    results.set(1, new TestResult(true, "second phrase"));
    const en = recognitionTranscripts(new TestRecognitionEvent(results), "en-US");
    expect(en.final).toBe("first phrase second phrase");
  });

  it("starts at resultIndex so unchanged final results are not inserted twice", () => {
    const results = new TestResultList([
      new TestResult(true, "already inserted"),
      new TestResult(true, "new phrase"),
    ]);
    expect(recognitionTranscripts(new TestRecognitionEvent(results, 1), "en-US").final).toBe("new phrase");
  });
});

describe("voice transcript insertion", () => {
  it("inserts Chinese at the selected cursor without adding spaces", () => {
    expect(voiceTranscriptInsertion("前文后文", 2, 2, " 新内容 ", "zh-CN")).toEqual({
      from: 2,
      to: 2,
      insert: "新内容",
      cursor: 5,
    });
  });

  it("replaces a selection and adds English word boundaries", () => {
    expect(voiceTranscriptInsertion("hello old text", 6, 10, "new", "en-US")).toEqual({
      from: 6,
      to: 10,
      insert: "new ",
      cursor: 10,
    });
    expect(voiceTranscriptInsertion("Hello.", 6, 6, "Next sentence", "en-US")?.insert).toBe(" Next sentence");
  });

  it("does not add a space before closing punctuation", () => {
    expect(voiceTranscriptInsertion("Hello.", 5, 5, "world", "en-US")?.insert).toBe(" world");
    expect(voiceTranscriptInsertion("item, next", 4, 4, "one", "en-US")?.insert).toBe(" one");
    expect(voiceTranscriptInsertion("call(value)", 10, 10, "now", "en-US")?.insert).toBe(" now");
  });

  it("ignores empty transcripts", () => {
    expect(voiceTranscriptInsertion("draft", 3, 3, "  ", "en-US")).toBeUndefined();
  });
});

describe("voice input errors", () => {
  it("explains permission failures on insecure remote origins", () => {
    expect(voiceRecognitionErrorMessage("not-allowed", false)).toContain("HTTPS or localhost");
    expect(voiceRecognitionErrorMessage("not-allowed", true)).toContain("Allow microphone access");
  });

  it("suppresses intentional abort errors and explains recoverable failures", () => {
    expect(voiceRecognitionErrorMessage("aborted", true)).toBeUndefined();
    expect(voiceRecognitionErrorMessage("no-speech", true)).toContain("No speech");
    expect(voiceRecognitionErrorMessage("network", true)).toContain("network connection");
  });
});

class TestResult implements SpeechRecognitionResultLike {
  readonly length = 1;

  constructor(readonly isFinal: boolean, transcript: string) {
    this[0] = { transcript };
  }

  [index: number]: SpeechRecognitionAlternativeLike;
}

class TestResultList implements Iterable<SpeechRecognitionResultLike> {
  private readonly values: SpeechRecognitionResultLike[];

  constructor(values: SpeechRecognitionResultLike[]) {
    this.values = values;
    this.syncIndexes();
  }

  get length(): number { return this.values.length; }
  [index: number]: SpeechRecognitionResultLike;

  set(index: number, value: SpeechRecognitionResultLike) {
    this.values[index] = value;
    this.syncIndexes();
  }

  [Symbol.iterator](): Iterator<SpeechRecognitionResultLike> {
    return this.values[Symbol.iterator]();
  }

  private syncIndexes() {
    for (const [index, value] of this.values.entries()) this[index] = value;
  }
}

class TestRecognitionEvent extends Event implements SpeechRecognitionEventLike {
  constructor(readonly results: TestResultList, readonly resultIndex = 0) {
    super("result");
  }
}
