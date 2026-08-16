// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSelection } from "@codemirror/state";
import type { SpeechRecognitionAlternativeLike, SpeechRecognitionErrorEventLike, SpeechRecognitionEventLike, SpeechRecognitionLike, SpeechRecognitionResultLike } from "../voiceInput";
import { PromptEditor } from "./PromptEditor";

let instances: FakeSpeechRecognition[] = [];
let standardDescriptor: PropertyDescriptor | undefined;
let prefixedDescriptor: PropertyDescriptor | undefined;
let secureContextDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  instances = [];
  standardDescriptor = Object.getOwnPropertyDescriptor(window, "SpeechRecognition");
  prefixedDescriptor = Object.getOwnPropertyDescriptor(window, "webkitSpeechRecognition");
  secureContextDescriptor = Object.getOwnPropertyDescriptor(window, "isSecureContext");
  Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true });
  Object.defineProperty(window, "webkitSpeechRecognition", { value: FakeSpeechRecognition, configurable: true });
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  FakeSpeechRecognition.throwOnStart = false;
  FakeSpeechRecognition.throwOnStop = false;
  localStorage.clear();
});

afterEach(() => {
  document.body.replaceChildren();
  restoreProperty(window, "SpeechRecognition", standardDescriptor);
  restoreProperty(window, "webkitSpeechRecognition", prefixedDescriptor);
  restoreProperty(window, "isSecureContext", secureContextDescriptor);
});

describe("PromptEditor voice input", () => {
  it("starts and stops Chrome recognition, then inserts final text at the cursor", async () => {
    const editor = await mountEditor();
    const onSend = vi.fn();
    editor.onSend = onSend;
    editor.replaceText("alpha omega");
    editor.view?.dispatch({ selection: EditorSelection.cursor(6) });
    const root = requiredShadowRoot(editor);
    const language = requiredSelect(root, ".voice-language");
    language.value = "en-US";
    language.dispatchEvent(new Event("change", { bubbles: true }));
    await editor.updateComplete;

    const microphone = requiredButton(root, ".voice-input-button");
    expect(root.querySelector("#voice-input-feedback")?.textContent).toContain("Chrome may send voice audio");
    expect(microphone.getAttribute("aria-describedby")).toBe("voice-input-feedback");
    microphone.click();
    const recognition = instances[0];
    if (recognition === undefined) throw new Error("Expected a recognition instance");
    expect(recognition.start).toHaveBeenCalledOnce();
    expect(recognition.lang).toBe("en-US");
    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(true);

    recognition.emitStart();
    await editor.updateComplete;
    expect(microphone.getAttribute("aria-pressed")).toBe("true");
    expect(root.querySelector("[role='status']")?.textContent).toContain("Listening in English");

    recognition.emitResult(result(false, "spoken wor"));
    await editor.updateComplete;
    const interim = root.querySelector("#voice-input-feedback");
    expect(interim?.textContent).toContain("Hearing: spoken wor");
    expect(interim?.getAttribute("aria-live")).toBe("off");
    expect(root.querySelector("[role='status']")).toBeNull();

    microphone.click();
    await editor.updateComplete;
    expect(recognition.stop).toHaveBeenCalledOnce();
    expect(microphone.getAttribute("aria-pressed")).toBe("true");
    expect(microphone.getAttribute("aria-label")).toBe("Finishing voice input");
    expect(microphone.disabled).toBe(true);
    expect(root.querySelector(".voice-stop-mark")).not.toBeNull();

    const sendButton = requiredButton(root, ".send-button");
    sendButton.focus();
    recognition.emitResult(result(true, "spoken"));
    recognition.emitEnd();
    await editor.updateComplete;
    expect(microphone.getAttribute("aria-pressed")).toBe("false");
    expect(root.querySelector("[role='status']")?.textContent).toContain("added to the draft");
    expect(editor.view?.state.doc.toString()).toBe("alpha spoken omega");
    expect(editor.view?.state.selection.main.head).toBe(13);
    expect(root.activeElement).toBe(sendButton);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables the control when the browser has no speech-recognition constructor", async () => {
    Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined, configurable: true });
    const editor = await mountEditor();
    const microphone = requiredButton(requiredShadowRoot(editor), ".voice-input-button");
    expect(microphone.disabled).toBe(true);
    expect(microphone.getAttribute("aria-label")).toContain("requires a browser");
    expect(requiredShadowRoot(editor).querySelector("#voice-input-feedback")?.textContent).toContain("requires Chrome");
  });

  it("shows HTTPS guidance when an insecure origin hides speech recognition", async () => {
    Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined, configurable: true });
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
    const editor = await mountEditor();
    expect(requiredShadowRoot(editor).querySelector("#voice-input-feedback")?.textContent).toContain("HTTPS or localhost");
  });

  it("explains the HTTPS requirement after Chrome denies access on HTTP", async () => {
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
    const editor = await mountEditor();
    const root = requiredShadowRoot(editor);
    requiredButton(root, ".voice-input-button").click();
    const recognition = instances[0];
    if (recognition === undefined) throw new Error("Expected a recognition instance");
    recognition.emitError("not-allowed");
    await editor.updateComplete;
    expect(root.querySelector("[role='alert']")?.textContent).toContain("HTTPS or localhost");
  });

  it("allows a second click to cancel recognition while it is starting", async () => {
    const editor = await mountEditor();
    const root = requiredShadowRoot(editor);
    const microphone = requiredButton(root, ".voice-input-button");
    microphone.click();
    const recognition = instances[0];
    if (recognition === undefined) throw new Error("Expected a recognition instance");
    microphone.click();
    await editor.updateComplete;
    expect(recognition.abort).toHaveBeenCalledOnce();
    expect(microphone.getAttribute("aria-pressed")).toBe("false");
    expect(root.querySelector("[role='status']")?.textContent).toContain("cancelled");
  });

  it("clears feedback and rejects stale callbacks after a session switch", async () => {
    const editor = await mountEditor();
    const root = requiredShadowRoot(editor);
    requiredButton(root, ".voice-input-button").click();
    const recognition = instances[0];
    const staleResult = recognition?.onresult;
    if (recognition === undefined || staleResult === null || staleResult === undefined) throw new Error("Expected recognition callback");
    recognition.emitStart();
    editor.sessionId = "next-session";
    await editor.updateComplete;
    editor.replaceText("new session draft");
    staleResult(new TestRecognitionEvent([result(true, "stale words")]));
    await editor.updateComplete;
    expect(recognition.abort).toHaveBeenCalledOnce();
    expect(root.querySelector("#voice-input-feedback")?.textContent).toContain("Chrome may send voice audio");
    expect(root.querySelector("#voice-input-feedback")?.textContent).not.toContain("Listening");
    expect(editor.view?.state.doc.toString()).toBe("new session draft");
  });

  it("recovers to idle when Chrome throws during start or stop", async () => {
    FakeSpeechRecognition.throwOnStart = true;
    const startEditor = await mountEditor();
    const startRoot = requiredShadowRoot(startEditor);
    const startMicrophone = requiredButton(startRoot, ".voice-input-button");
    startMicrophone.click();
    await startEditor.updateComplete;
    expect(startMicrophone.getAttribute("aria-pressed")).toBe("false");
    expect(startRoot.querySelector("[role='alert']")?.textContent).toContain("could not start");

    startEditor.remove();
    FakeSpeechRecognition.throwOnStart = false;
    FakeSpeechRecognition.throwOnStop = true;
    const stopEditor = await mountEditor();
    const stopRoot = requiredShadowRoot(stopEditor);
    const stopMicrophone = requiredButton(stopRoot, ".voice-input-button");
    stopMicrophone.click();
    const recognition = instances[instances.length - 1];
    if (recognition === undefined) throw new Error("Expected a recognition instance");
    recognition.emitStart();
    stopMicrophone.click();
    await stopEditor.updateComplete;
    expect(stopMicrophone.getAttribute("aria-pressed")).toBe("false");
    expect(stopRoot.querySelector("[role='status']")?.textContent).toContain("stopped");
  });

  it("aborts active recognition when the editor disconnects", async () => {
    const editor = await mountEditor();
    requiredButton(requiredShadowRoot(editor), ".voice-input-button").click();
    const recognition = instances[0];
    if (recognition === undefined) throw new Error("Expected a recognition instance");
    recognition.emitStart();
    editor.remove();
    expect(recognition.abort).toHaveBeenCalledOnce();
  });
});

class FakeSpeechRecognition implements SpeechRecognitionLike {
  static throwOnStart = false;
  static throwOnStop = false;
  continuous = false;
  interimResults = false;
  lang = "";
  maxAlternatives = 1;
  onstart: SpeechRecognitionLike["onstart"] = null;
  onresult: SpeechRecognitionLike["onresult"] = null;
  onerror: SpeechRecognitionLike["onerror"] = null;
  onend: SpeechRecognitionLike["onend"] = null;
  readonly start = vi.fn(() => {
    if (FakeSpeechRecognition.throwOnStart) throw new Error("start failed");
  });
  readonly stop = vi.fn(() => {
    if (FakeSpeechRecognition.throwOnStop) throw new Error("stop failed");
  });
  readonly abort = vi.fn();

  constructor() {
    instances.push(this);
  }

  emitStart() {
    this.onstart?.(new Event("start"));
  }

  emitResult(...results: SpeechRecognitionResultLike[]) {
    this.onresult?.(new TestRecognitionEvent(results));
  }

  emitError(error: string) {
    this.onerror?.(new TestRecognitionErrorEvent(error));
  }

  emitEnd() {
    this.onend?.(new Event("end"));
  }
}

async function mountEditor(): Promise<PromptEditor> {
  const editor = new PromptEditor();
  editor.machineId = "local";
  editor.sessionId = "voice-test";
  document.body.append(editor);
  await editor.updateComplete;
  return editor;
}

function result(isFinal: boolean, transcript: string): SpeechRecognitionResultLike {
  return new TestResult(isFinal, transcript);
}

class TestResult implements SpeechRecognitionResultLike {
  readonly length = 1;
  [index: number]: SpeechRecognitionAlternativeLike;

  constructor(readonly isFinal: boolean, transcript: string) {
    this[0] = { transcript };
  }
}

class TestResultList {
  [index: number]: SpeechRecognitionResultLike;

  constructor(private readonly values: SpeechRecognitionResultLike[]) {
    for (const [index, value] of values.entries()) this[index] = value;
  }

  get length(): number { return this.values.length; }
}

class TestRecognitionEvent extends Event implements SpeechRecognitionEventLike {
  readonly resultIndex = 0;
  readonly results: TestResultList;

  constructor(results: SpeechRecognitionResultLike[]) {
    super("result");
    this.results = new TestResultList(results);
  }
}

class TestRecognitionErrorEvent extends Event implements SpeechRecognitionErrorEventLike {
  constructor(readonly error: string) {
    super("error");
  }
}

function requiredShadowRoot(editor: PromptEditor): ShadowRoot {
  if (editor.shadowRoot === null) throw new Error("Expected PromptEditor shadow root");
  return editor.shadowRoot;
}

function requiredButton(root: ParentNode, selector: string): HTMLButtonElement {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Expected button ${selector}`);
  return element;
}

function requiredSelect(root: ParentNode, selector: string): HTMLSelectElement {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`Expected select ${selector}`);
  return element;
}

function restoreProperty(target: object, key: PropertyKey, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(target, key);
  } else {
    Object.defineProperty(target, key, descriptor);
  }
}
