import { LocalizationController } from "../localization/browser";
import { promptEditorMessages as messages } from "../promptEditorMessages";
import { defaultKeymap, history, historyKeymap, indentWithTab, insertNewlineAndIndent } from "@codemirror/commands";
import { markdown, deleteMarkupBackward, insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, Compartment } from "@codemirror/state";
import { drawSelection, EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultHighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { stylesheetIntegrationCapability } from "../plugins/styles";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { api, DEFAULT_WORKSPACE_ATTACHMENTS_FOLDER, type FileSuggestion, type PromptAttachment, type SessionModel, type SessionStatus, type SlashCommand } from "../api";
import type { PromptAttachmentDelivery } from "../../../shared/apiTypes";
import { capturePromptAttachments, effectivePromptAttachmentDelivery, isInlinePromptAttachment, promptAttachmentsCanUseInlineDelivery } from "../promptAttachmentCapture";
import { inputModeForDraft, inputModesEqual, type InputMode } from "../inputModes";
import { machineSessionKey } from "../machineKeys";
import type { StagedPromptChip } from "../promptChips";
import { detectPromptCompletionTrigger, fileCompletionInsertText, modelCompletionChoices, type PromptCompletionTrigger } from "../promptCompletions";
import { promptArgumentHintExtension, setPromptArgumentHint } from "../promptArgumentHint";
import { clearDraft, loadDraft, saveDraft } from "../promptDraftStorage";
import { clearStagedAttachments, loadStagedAttachments, saveStagedAttachments, type PendingAttachment } from "../promptAttachmentStaging";
import { loadAttachmentDelivery, saveAttachmentDelivery } from "../attachmentPreferences";
import { MOBILE_PROMPT_ENTER_MEDIA_QUERY, shouldUsePromptEnterShiftShortcut } from "../promptEnterBehavior";
import { composerSendShortcut, matchesComposerSend } from "../composerShortcuts";
import { normalizeShortcut, type ShortcutPreferenceConfig } from "../keyboardShortcuts";
import { browserIsSecureContext, browserSpeechRecognitionConstructor, recognitionTranscripts, voiceRecognitionErrorMessage, voiceTranscriptInsertion, type SpeechRecognitionLike, type VoiceInputLanguage } from "../voiceInput";
import { loadVoiceInputLanguage, saveVoiceInputLanguage } from "../voiceInputPreferences";
import { promptEditorStyles, type CompletionItem } from "./shared";
import { renderAttachIcon, renderMicrophoneIcon, renderCameraIcon, renderPhotosIcon, renderSendIcon, renderQueueIcon, renderSteerIcon, renderStopIcon, renderThinkingGauge } from "./promptEditorIcons";
import { AnchoredPopupController } from "./anchoredPopup";
import { thinkingGauge, thinkingLevelLabel } from "../../../shared/thinkingLevels";
import "./AutocompleteMenu";

/** Fork: browser speech recognition dictation into the draft. */
type VoiceInputState = "idle" | "starting" | "listening" | "stopping";

function shouldShowAttachSourceMenu(): boolean {
  // Android needs an image-only input to offer photo-library sources. Other
  // platforms use their native chooser directly, including unknown devices;
  // pointer type does not tell us which native attachment sources are offered.
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

// Text nodes inside contenteditable can become iOS keyboard context, even in
// non-editable placeholder widgets. Render the hint with CSS-generated content.
function createPromptPlaceholder(): HTMLElement {
  const hint = document.createElement("span");
  hint.className = "prompt-placeholder";
  hint.dataset["placeholder"] = messages.t("placeholder");
  return hint;
}

type PromptSendArgs = [text: string, streamingBehavior?: "steer" | "followUp", attachments?: PromptAttachment[], delivery?: PromptAttachmentDelivery, folder?: string, chips?: readonly StagedPromptChip[]];
// Existing composer consumers may still send fire-and-forget; only a boolean
// promise confirms the new chip-bearing submission path.
type PromptSendHandler = ((...args: PromptSendArgs) => void | Promise<void>) | ((...args: PromptSendArgs) => Promise<boolean>);

@customElement("prompt-editor")
export class PromptEditor extends LitElement {
  constructor() {
    super();
    stylesheetIntegrationCapability.createController(this);
    new LocalizationController(this, undefined, () => { this.editorLabelsDirty = true; });
  }

  @property({ type: Boolean }) disabled = false;
  @property({ attribute: false }) shortcuts: ShortcutPreferenceConfig = {};
  @property() defaultStreamingBehavior: "steer" | "followUp" = "steer";
  @property() sessionId?: string;
  @property() cwd?: string;
  @property() machineId = "local";
  @property() projectId?: string;
  @property() workspaceId?: string;
  /**
   * Workspace-effective folder for the "save to folder" attachment delivery.
   * Shown in the delivery label and sent explicitly with the save request, so
   * the save destination is always the folder the label advertised.
   */
  @property() attachmentsFolder = DEFAULT_WORKSPACE_ATTACHMENTS_FOLDER;
  @property({ attribute: false }) chatNavigation: TemplateResult | undefined;
  @property({ type: Boolean }) canSteer = false;
  @property({ type: Boolean }) isCompacting = false;
  @property({ type: Boolean }) canStop = false;
  @property({ attribute: false }) status?: SessionStatus;
  @property({ type: Boolean }) sending = false;
  @property({ attribute: false }) promptChips: readonly StagedPromptChip[] = [];
  @property({ attribute: false }) onRemoveChip?: (chip: StagedPromptChip) => void;
  @property({ attribute: false }) onSend?: PromptSendHandler;
  @property({ attribute: false }) onStop?: () => void;
  @property({ attribute: false }) onSelectModel?: () => void;
  @property({ attribute: false }) onSelectThinking?: () => void;
  @property({ attribute: false }) availableThinkingLevels: readonly string[] = [];
  @query(".markdown-editor") private editorHost?: HTMLDivElement;
  @query(".attachment-input") private attachmentInput?: HTMLInputElement;
  @query(".attachment-image-input") private attachmentImageInput?: HTMLInputElement;
  @query(".attachment-camera-input") private attachmentCameraInput?: HTMLInputElement;
  @query(".attach-source-panel") private attachSourcePanel?: HTMLDivElement;
  @query(".editor-attach") private attachButton?: HTMLButtonElement;
  // `draft` is the live document text but is intentionally NOT reactive: it
  // changes on every keystroke and the visible text is owned by CodeMirror, not
  // by Lit's render. Re-rendering the surrounding template on each keystroke is
  // wasted work and, on iOS, can interrupt an in-progress touch gesture (the
  // long-press edit/paste callout). Only `currentInputMode` (shell vs. normal)
  // is reactive, since that is the only draft-derived value the template shows.
  private draft = "";
  @state() private currentInputMode: InputMode = { kind: "normal" };
  @state() private completions: CompletionItem[] = [];
  @state() private selectedIndex = 0;
  @state() private attachments: readonly PendingAttachment[] = [];
  @state() private attachmentDelivery: PromptAttachmentDelivery = loadAttachmentDelivery();
  @state() private attachmentError: true | undefined = undefined;
  @state() private chipSendingKey: string | undefined = undefined;
  @state() private chipError: { kind: "retry" } | { kind: "failed"; error: string } | undefined = undefined;
  @state() private attachSourceOpen = false;
  private readonly attachPopup = new AnchoredPopupController(this, () => {
    if (!this.attachSourceOpen || !this.attachButton || !this.attachSourcePanel) return undefined;
    return {
      anchor: this.attachButton,
      panel: this.attachSourcePanel,
      onClose: () => { this.attachSourceOpen = false; },
      options: { minWidth: 210 },
    };
  });
  private attachmentSeq = 0;
  private requestVersion = 0;
  @state() private voiceInputState: VoiceInputState = "idle";
  @state() private voiceInputLanguage: VoiceInputLanguage = loadVoiceInputLanguage();
  @state() private voiceInputSupported = browserSpeechRecognitionConstructor() !== undefined;
  @state() private voiceInputMessage: string | undefined = undefined;
  @state() private voiceInputError: string | undefined = undefined;
  @state() private voiceInputInterim = "";
  private voiceRecognition: SpeechRecognitionLike | undefined;
  private voiceRecognitionGeneration = 0;
  private voiceHadFinalResult = false;
  private readonly voiceSecureContext = browserIsSecureContext();
  private editor: EditorView | undefined;
  private editorLabelsDirty = true;
  private readonly editorLabelsCompartment = new Compartment();
  private readonly editableCompartment = new Compartment();
  private readonly readOnlyCompartment = new Compartment();
  private readonly mobilePromptEnterMedia = typeof window !== "undefined" && "matchMedia" in window
    ? window.matchMedia(MOBILE_PROMPT_ENTER_MEDIA_QUERY) : undefined;
  private readonly handleShortcutMediaChange = (): void => { this.requestUpdate(); };
  private explicitShiftKeyActive = false;

  protected override willUpdate(changed: PropertyValues<this>) {
    if (this.busy || changed.has("sessionId") || changed.has("machineId")) this.attachSourceOpen = false;
    if (!changed.has("sessionId") && !changed.has("machineId")) return;
    this.cancelVoiceInput();
    const previousSessionId = changed.has("sessionId") ? changed.get("sessionId") : this.sessionId;
    const previousMachineId = changed.has("machineId") ? changed.get("machineId") : this.machineId;
    const previousKey = draftStorageKey(previousMachineId, previousSessionId);
    if (previousKey !== undefined) {
      saveDraft(previousKey, this.draft);
      saveStagedAttachments(previousKey, this.attachments);
    }
    const currentKey = draftStorageKey(this.machineId, this.sessionId);
    this.draft = currentKey !== undefined ? loadDraft(currentKey) : "";
    this.attachments = currentKey !== undefined ? loadStagedAttachments(currentKey) : [];
    this.attachmentError = undefined;
    this.chipError = undefined;
    this.currentInputMode = inputModeForDraft(this.draft);
    this.completions = [];
    this.selectedIndex = 0;
  }

  protected override shouldUpdate(changed: PropertyValues<this>): boolean {
    // Status updates churn once per token during streaming and hand us a fresh
    // object reference each time. When nothing else changed, only re-render if a
    // status field the template actually displays differs, so streaming does not
    // disturb the editor DOM (and any in-progress touch gesture survives).
    if (!this.editorLabelsDirty && changed.has("status") && changed.size === 1) {
      return !sessionStatusRenderEqual(changed.get("status"), this.status);
    }
    return true;
  }

  override firstUpdated(): void {
    this.createEditor();
  }

  private get submitting(): boolean {
    return this.sending || this.chipSendingKey === this.composerKey();
  }

  private get busy(): boolean {
    return this.disabled || this.submitting;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.mobilePromptEnterMedia?.addEventListener("change", this.handleShortcutMediaChange);
    this.requestUpdate();
  }

  protected override updated(changed: PropertyValues) {
    if (this.editorLabelsDirty) {
      this.editorLabelsDirty = false;
      this.editor?.dispatch({ effects: this.editorLabelsCompartment.reconfigure(this.editorLabels()) });
    }
    if (changed.has("disabled")) this.updateEditorDisabledState();
    if (changed.has("sessionId") || changed.has("machineId")) this.syncEditorDoc();
    if ((changed.has("disabled") || changed.has("sending")) && (this.disabled || this.sending)) this.cancelVoiceInput();
  }

  override disconnectedCallback(): void {
    this.mobilePromptEnterMedia?.removeEventListener("change", this.handleShortcutMediaChange);
    this.attachSourceOpen = false;
    this.cancelVoiceInput();
    this.editor?.destroy();
    this.editor = undefined;
    super.disconnectedCallback();
  }

  override render() {
    const shellInputMode = this.promptChips.length === 0 && this.currentInputMode.kind === "shell" ? this.currentInputMode : undefined;
    const shellMode = shellInputMode !== undefined;
    const queuesInput = this.canSteer || this.isCompacting;
    const keyboardSteers = this.defaultSendBehavior() === "steer";
    const busy = this.busy;
    const submitAction = queuesInput ? "queue" : "send";
    const shortcut = composerSendShortcut(this.shortcuts, this.mobilePromptEnterMedia);
    const hasSendShortcut = shortcut !== null && normalizeShortcut(shortcut).length === 1;
    const defaultAction = busy || !hasSendShortcut ? "none" : keyboardSteers ? "steer" : submitAction;
    const sourceMenu = shouldShowAttachSourceMenu();
    return html`
      <footer data-ui-context="composer" data-mode=${shellMode ? "shell" : "text"} data-busy=${this.submitting} data-disabled=${this.disabled} data-compacting=${this.isCompacting} data-default-action=${defaultAction} class=${shellMode ? "shell-mode" : ""} @paste=${(event: ClipboardEvent) => { void this.handlePaste(event); }} @dragover=${(event: DragEvent) => { this.handleDragOver(event); }} @drop=${(event: DragEvent) => { void this.handleDrop(event); }}>
        <div class="editor-wrap">
          <div class="editor-input">
            <div class=${`markdown-editor${this.disabled ? " markdown-editor-disabled" : ""}`} aria-label=${messages.t("message")} aria-disabled=${this.disabled ? "true" : "false"}></div>
            ${this.chatNavigation === undefined ? null : html`<div class="editor-chat-navigation">${this.chatNavigation}</div>`}
            <input class="attachment-input" type="file" multiple hidden @change=${(event: Event) => { void this.handleFileInput(event); }} />
            <input class="attachment-image-input" type="file" multiple accept="image/*" hidden @change=${(event: Event) => { void this.handleFileInput(event); }} />
            <input class="attachment-camera-input" type="file" accept="image/*" capture="environment" hidden @change=${(event: Event) => { void this.handleFileInput(event); }} />
            <button type="button" class=${`editor-attach icon-button ui-button ui-button--icon${sourceMenu ? " ui-popup-trigger" : ""}`} data-composer-action="attach" ?disabled=${busy} title=${messages.t("attach")} aria-label=${messages.t("attach")} aria-controls=${sourceMenu ? "attach-source-panel" : nothing} aria-expanded=${sourceMenu ? String(this.attachSourceOpen) : nothing} @click=${() => { this.handleAttachClick(); }}>${renderAttachIcon()}</button>
            <div id="attach-source-panel" class="attach-source-panel ui-menu ui-popup-panel" data-ui-context="composer-attachment-sources" popover="auto" role="group" aria-label=${messages.t("source")}>
              <button type="button" class="ui-button ui-menu-item" data-composer-action="attach-photos" ?disabled=${busy} title=${messages.t("photosTitle")} @click=${() => { this.openAttachmentPicker(this.attachmentImageInput); }}><span class="attach-source-icon" aria-hidden="true">${renderPhotosIcon()}</span><span class="attach-source-label">${messages.t("photos")}</span></button>
              <button type="button" class="ui-button ui-menu-item" data-composer-action="attach-camera" ?disabled=${busy} title=${messages.t("cameraTitle")} @click=${() => { this.openAttachmentPicker(this.attachmentCameraInput); }}><span class="attach-source-icon" aria-hidden="true">${renderCameraIcon()}</span><span class="attach-source-label">${messages.t("camera")}</span></button>
              <button type="button" class="ui-button ui-menu-item" data-composer-action="attach-files" ?disabled=${busy} title=${messages.t("filesTitle")} @click=${() => { this.openAttachmentPicker(this.attachmentInput); }}><span class="attach-source-icon" aria-hidden="true">${renderAttachIcon()}</span><span class="attach-source-label">${messages.t("files")}</span></button>
            </div>
            ${shellMode ? html`<div class="mode-hint">${messages.t("shell", { excluded: shellInputMode.excludeFromContext ? "yes" : "no" })}</div>` : null}
            ${this.isCompacting && !shellMode ? html`<div class="mode-hint">${messages.t("compacting")}</div>` : null}
          </div>
          ${this.renderPromptChips()}
          ${this.renderAttachments()}
          <autocomplete-menu .onClose=${() => { this.closeCompletions(); }} .items=${this.completions} .selectedIndex=${this.selectedIndex} .onPick=${(item: CompletionItem) => { this.pick(item); }}></autocomplete-menu>
        </div>
        ${this.renderVoiceInputFeedback()}
        <div class="actions ui-toolbar ui-toolbar--primary ui-toolbar--borderless ui-composer-toolbar">
          ${this.renderCompactStatus()}
          ${this.renderVoiceInputControls(busy)}
          <div class="ui-toolbar-group ui-composer-actions">
            <button class="ui-button ui-button--icon icon-button send-button ${defaultAction === submitAction ? "default-send-action" : ""}" data-composer-action=${submitAction} data-default=${defaultAction === submitAction} ?disabled=${busy} title=${messages.t(queuesInput ? "queueTitle" : "send")} aria-label=${messages.t(queuesInput ? "queue" : "send")} @click=${() => { this.send("followUp"); }}>${queuesInput ? renderQueueIcon() : renderSendIcon()}</button>
            ${this.canSteer && !this.isCompacting ? html`<button class="ui-button ui-button--icon icon-button steer-button ${defaultAction === "steer" ? "default-send-action" : ""}" data-composer-action="steer" data-default=${defaultAction === "steer"} ?disabled=${busy} title=${messages.t("steerTitle")} aria-label=${messages.t("steer")} @click=${() => { this.send("steer"); }}>${renderSteerIcon()}</button>` : null}
            <button class="ui-button ui-button--icon icon-button stop-button" data-composer-action="stop" ?disabled=${this.disabled || !this.canStop} title=${messages.t(this.canStop ? "stopTitle" : "idle")} aria-label=${messages.t("stop")} @click=${() => this.onStop?.()}>${renderStopIcon()}</button>
          </div>
        </div>
      </footer>
    `;
  }

  focusInput() {
    this.editor?.focus();
  }

  private renderVoiceInputControls(busy: boolean) {
    const active = this.voiceInputState !== "idle";
    const unavailable = !this.voiceInputSupported;
    const stopping = this.voiceInputState === "stopping";
    const title = unavailable
      ? "Voice input requires a browser with Web Speech recognition, such as Chrome"
      : active
        ? stopping ? "Finishing voice input" : "Stop voice input"
        : "Start voice input";
    const label = stopping ? "Finishing voice input" : active ? "Stop voice input" : "Start voice input";
    return html`
      <div class="voice-input-controls" aria-label="Voice input controls">
        <select
          class="voice-language"
          title="Voice input language"
          aria-label="Voice input language"
          .value=${this.voiceInputLanguage}
          ?disabled=${busy || active}
          @change=${(event: Event) => { this.changeVoiceInputLanguage(event); }}
        >
          <option value="zh-CN">中文</option>
          <option value="en-US">English</option>
        </select>
        <button
          class=${`ui-button ui-button--icon icon-button voice-input-button${active ? " voice-input-active" : ""}`}
          ?disabled=${busy || unavailable || stopping}
          title=${title}
          aria-label=${unavailable ? title : label}
          aria-describedby=${this.hasVoiceInputFeedback() ? "voice-input-feedback" : nothing}
          aria-pressed=${active ? "true" : "false"}
          @click=${() => { this.toggleVoiceInput(); }}
        >${renderMicrophoneIcon(active)}</button>
      </div>
    `;
  }

  private renderVoiceInputFeedback() {
    if (this.voiceInputError !== undefined) {
      return html`<div id="voice-input-feedback" class="voice-input-feedback voice-input-error" role="alert">${this.voiceInputError}</div>`;
    }
    if (!this.voiceInputSupported) {
      const guidance = this.voiceSecureContext
        ? "Voice input requires Chrome or another browser with Web Speech recognition."
        : "Voice input requires a compatible Chrome browser and may require Pi Web to be opened over HTTPS or localhost.";
      return html`<div id="voice-input-feedback" class="voice-input-feedback voice-input-guidance">${guidance}</div>`;
    }
    if (this.voiceInputInterim !== "") {
      return html`<div id="voice-input-feedback" class="voice-input-feedback" aria-live="off">Hearing: ${this.voiceInputInterim}</div>`;
    }
    if (this.voiceInputMessage !== undefined) {
      return html`<div id="voice-input-feedback" class="voice-input-feedback" role="status" aria-live="polite">${this.voiceInputMessage}</div>`;
    }
    return null;
  }

  private hasVoiceInputFeedback(): boolean {
    return this.voiceInputError !== undefined
      || !this.voiceInputSupported
      || this.voiceInputInterim !== ""
      || this.voiceInputMessage !== undefined;
  }

  replaceText(text: string): void {
    this.draft = text;
    const key = draftStorageKey(this.machineId, this.sessionId);
    if (key !== undefined) saveDraft(key, text);

    const editor = this.editor;
    if (editor !== undefined) {
      const current = editor.state.doc.toString();
      editor.dispatch({
        ...(current === text ? {} : { changes: { from: 0, to: current.length, insert: text } }),
        selection: EditorSelection.cursor(text.length),
      });
    }

    // Invalidate completion requests started for either the previous document or
    // the replacement dispatch, then return the editor to a clean completion state.
    this.requestVersion += 1;
    this.currentInputMode = inputModeForDraft(text);
    this.completions = [];
    this.selectedIndex = 0;
  }

  /** Get the underlying CM6 EditorView, or undefined if not yet mounted. */
  get view(): EditorView | undefined {
    return this.editor;
  }

  private renderCompactStatus() {
    const status = this.status;
    if (status === undefined) return null;
    const model = status.model?.id ?? messages.t("noModel");
    const provider = status.model?.provider !== undefined && status.model.provider !== "" ? `${status.model.provider}/` : "";
    return html`
      <div class="compact-status" aria-label=${messages.t("status")}>
        <div class="ui-toolbar-group ui-toolbar-group--bounded ui-composer-settings">
          <button class="ui-button select-model" data-composer-action="model" title=${messages.t("selectModel")} @click=${() => this.onSelectModel?.()}>${provider}${model}</button>
          <button class="ui-button ui-button--icon select-thinking icon-button" data-composer-action="thinking" title=${messages.t("thinking", { level: thinkingLevelLabel(status.thinkingLevel) })} aria-label=${messages.t("thinking", { level: thinkingLevelLabel(status.thinkingLevel) })} @click=${() => this.onSelectThinking?.()}>${renderThinkingGauge(thinkingGauge(status.thinkingLevel, this.availableThinkingLevels))}</button>
        </div>
      </div>
    `;
  }

  private renderPromptChips() {
    if (this.promptChips.length === 0 && this.chipError === undefined) return null;
    return html`
      <div class="prompt-chips" aria-label=${messages.t("context")}>
        ${this.promptChips.map((chip) => html`
          <div class="prompt-chip" title=${chip.text}>
            <span dir="auto">${chip.label}</span>
            <button type="button" class="ui-button ui-button--compact ui-button--icon" aria-label=${messages.t("remove", { name: chip.label })} ?disabled=${this.disabled} @click=${() => this.onRemoveChip?.(chip)}>×</button>
          </div>
        `)}
        ${this.chipError === undefined ? null : html`<div class="chip-error" role="alert">${this.chipError.kind === "retry" ? messages.t("retry") : messages.t("submitFailed", { error: this.chipError.error })}</div>`}
      </div>
    `;
  }

  private changeVoiceInputLanguage(event: Event) {
    if (!(event.target instanceof HTMLSelectElement)) return;
    const language = event.target.value;
    if (language !== "zh-CN" && language !== "en-US") {
      event.target.value = this.voiceInputLanguage;
      return;
    }
    this.voiceInputLanguage = language;
    saveVoiceInputLanguage(language);
    this.voiceInputMessage = undefined;
    this.voiceInputError = undefined;
  }

  private toggleVoiceInput() {
    if (this.voiceInputState === "idle") {
      this.startVoiceInput();
      return;
    }
    if (this.voiceInputState === "starting") {
      this.cancelVoiceInput();
      this.voiceInputMessage = "Voice input cancelled.";
      return;
    }
    if (this.voiceInputState === "listening") this.stopVoiceInput();
  }

  private startVoiceInput() {
    if (this.disabled || this.sending) return;
    const Recognition = browserSpeechRecognitionConstructor();
    if (Recognition === undefined) {
      this.voiceInputSupported = false;
      this.voiceInputError = "Voice input is unavailable in this browser. Open Pi Web in Chrome and try again.";
      return;
    }

    this.cancelVoiceInput();
    let recognition: SpeechRecognitionLike;
    try {
      recognition = new Recognition();
    } catch {
      this.voiceInputError = "Chrome could not initialize speech recognition. Reload Pi Web and try again.";
      return;
    }
    const generation = ++this.voiceRecognitionGeneration;
    this.voiceRecognition = recognition;
    this.voiceHadFinalResult = false;
    this.voiceInputState = "starting";
    this.voiceInputMessage = this.voiceInputLanguage === "zh-CN" ? "Starting Chinese voice input…" : "Starting English voice input…";
    this.voiceInputError = undefined;
    this.voiceInputInterim = "";
    recognition.lang = this.voiceInputLanguage;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      if (!this.isCurrentRecognition(recognition, generation)) return;
      this.voiceInputState = "listening";
      this.voiceInputMessage = this.voiceInputLanguage === "zh-CN" ? "Listening in Chinese…" : "Listening in English…";
    };
    recognition.onresult = (event) => {
      if (!this.isCurrentRecognition(recognition, generation)) return;
      const transcripts = recognitionTranscripts(event, this.voiceInputLanguage);
      this.voiceInputInterim = transcripts.interim;
      if (transcripts.final !== "") {
        this.voiceHadFinalResult = true;
        this.insertVoiceTranscript(transcripts.final);
        this.voiceInputMessage = "Voice input added to the draft. Listening…";
      }
    };
    recognition.onerror = (event) => {
      if (!this.isCurrentRecognition(recognition, generation)) return;
      const message = voiceRecognitionErrorMessage(event.error, this.voiceSecureContext);
      if (message !== undefined) this.voiceInputError = message;
      this.voiceInputInterim = "";
    };
    recognition.onend = () => {
      if (!this.isCurrentRecognition(recognition, generation)) return;
      this.releaseVoiceRecognition(recognition);
      this.voiceInputState = "idle";
      this.voiceInputInterim = "";
      if (this.voiceInputError === undefined) {
        this.voiceInputMessage = this.voiceHadFinalResult ? "Voice input added to the draft." : "Voice input stopped.";
      }
    };

    try {
      recognition.start();
    } catch {
      this.releaseVoiceRecognition(recognition);
      this.voiceInputState = "idle";
      this.voiceInputError = this.voiceSecureContext
        ? "Chrome could not start voice input. Check microphone permission and try again."
        : "Chrome could not start voice input on this HTTP address. Open Pi Web over HTTPS or localhost and try again.";
    }
  }

  private stopVoiceInput() {
    const recognition = this.voiceRecognition;
    if (recognition === undefined) return;
    this.voiceInputState = "stopping";
    this.voiceInputInterim = "";
    this.voiceInputMessage = "Finishing voice input…";
    try {
      recognition.stop();
    } catch {
      this.cancelVoiceInput();
      this.voiceInputMessage = "Voice input stopped.";
    }
  }

  private cancelVoiceInput() {
    const recognition = this.voiceRecognition;
    this.voiceRecognition = undefined;
    this.voiceRecognitionGeneration += 1;
    this.voiceInputState = "idle";
    this.voiceInputInterim = "";
    this.voiceInputMessage = undefined;
    this.voiceInputError = undefined;
    if (recognition === undefined) return;
    this.clearVoiceRecognitionHandlers(recognition);
    try {
      recognition.abort();
    } catch {
      // Cancellation is best-effort when the browser has already ended recognition.
    }
  }

  private releaseVoiceRecognition(recognition: SpeechRecognitionLike) {
    if (this.voiceRecognition === recognition) this.voiceRecognition = undefined;
    this.clearVoiceRecognitionHandlers(recognition);
  }

  private clearVoiceRecognitionHandlers(recognition: SpeechRecognitionLike) {
    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
  }

  private isCurrentRecognition(recognition: SpeechRecognitionLike, generation: number): boolean {
    return this.voiceRecognition === recognition && this.voiceRecognitionGeneration === generation;
  }

  private insertVoiceTranscript(transcript: string) {
    const editor = this.editor;
    if (editor === undefined) {
      this.replaceText(`${this.draft}${transcript}`);
      return;
    }
    const selection = editor.state.selection.main;
    const draft = editor.state.doc.toString();
    const insertion = voiceTranscriptInsertion(draft, selection.from, selection.to, transcript, this.voiceInputLanguage);
    if (insertion === undefined) return;
    editor.dispatch({
      changes: { from: insertion.from, to: insertion.to, insert: insertion.insert },
      selection: EditorSelection.cursor(insertion.cursor),
      scrollIntoView: true,
    });
  }

  private renderAttachments() {
    if (this.attachments.length === 0 && this.attachmentError === undefined) return null;
    const canUseInlineDelivery = promptAttachmentsCanUseInlineDelivery(this.attachments);
    const delivery = this.effectiveAttachmentDelivery();
    return html`
      <div class="attachments" aria-label=${messages.t("attachments")}>
        ${this.attachments.map((attachment) => html`
          <div class=${`attachment-chip ${isInlinePromptAttachment(attachment) ? "attachment-chip-image" : "attachment-chip-file"}`} title=${attachment.name}>
            ${this.renderAttachmentPreview(attachment)}
            <button type="button" class="ui-button ui-button--compact ui-button--icon attachment-remove" title=${messages.t("removeAttachment")} aria-label=${messages.t("remove", { name: attachment.name })} @click=${() => { this.removeAttachment(attachment.id); }}>×</button>
          </div>
        `)}
        ${this.attachments.length > 0 ? html`
          <label class="attachment-delivery" title=${messages.t(canUseInlineDelivery ? "deliveryTitle" : "filesDeliveryTitle")}>
            <select class="ui-select" aria-label=${messages.t("delivery")} .value=${delivery} @change=${(event: Event) => { this.changeDelivery(event); }}>
              <option value="inline" ?disabled=${!canUseInlineDelivery}>${messages.t("inline", { available: canUseInlineDelivery ? "yes" : "no" })}</option>
              <option value="folder">${attachmentFolderDeliveryLabel(this.attachmentsFolder)}</option>
            </select>
          </label>
        ` : null}
        ${this.attachmentError !== undefined ? html`<div class="attachment-error">${messages.t("readFailed")}</div>` : null}
      </div>
    `;
  }

  private renderAttachmentPreview(attachment: PendingAttachment) {
    if (isInlinePromptAttachment(attachment)) {
      return html`<img src=${`data:${attachment.mimeType};base64,${attachment.data}`} alt=${attachment.name} />`;
    }
    return html`
      <div class="attachment-file-preview" aria-hidden="true">${fileExtensionLabel(attachment.name)}</div>
      <span class="attachment-file-name" dir="auto">${attachment.name}</span>
    `;
  }

  private changeDelivery(event: Event) {
    if (!(event.target instanceof HTMLSelectElement)) return;
    const requested = event.target.value === "folder" ? "folder" : "inline";
    if (requested === "inline" && !promptAttachmentsCanUseInlineDelivery(this.attachments)) {
      event.target.value = "folder";
      return;
    }
    this.attachmentDelivery = requested;
    saveAttachmentDelivery(this.attachmentDelivery);
  }

  private removeAttachment(id: string) {
    this.attachments = this.attachments.filter((attachment) => attachment.id !== id);
  }

  private async handlePaste(event: ClipboardEvent) {
    const files = filesFromDataTransfer(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    await this.addAttachmentFiles(files);
  }

  private handleDragOver(event: DragEvent) {
    if (event.dataTransfer === null) return;
    if (dataTransferHasFiles(event.dataTransfer)) event.preventDefault();
  }

  private async handleDrop(event: DragEvent) {
    const files = filesFromDataTransfer(event.dataTransfer);
    if (files.length === 0) return;
    event.preventDefault();
    await this.addAttachmentFiles(files);
  }

  private handleAttachClick(): void {
    if (this.busy) return;
    if (shouldShowAttachSourceMenu()) {
      this.attachSourceOpen = !this.attachSourceOpen;
      return;
    }
    this.attachmentInput?.click();
  }

  private openAttachmentPicker(input: HTMLInputElement | undefined): void {
    if (this.busy) return;
    this.attachPopup.close();
    this.attachButton?.focus();
    input?.click();
  }

  private async handleFileInput(event: Event) {
    if (!(event.target instanceof HTMLInputElement) || event.target.files === null) return;
    const files = Array.from(event.target.files);
    event.target.value = "";
    await this.addAttachmentFiles(files);
  }

  private async addAttachmentFiles(files: File[]) {
    this.attachmentError = undefined;
    const { attachments, error } = await capturePromptAttachments(files, readFileAsBase64);
    if (attachments.length > 0) {
      this.attachments = [...this.attachments, ...attachments.map((attachment) => ({ id: `attachment-${String(++this.attachmentSeq)}`, ...attachment }))];
    }
    if (error !== undefined) this.attachmentError = true;
  }

  private currentAttachments(): PromptAttachment[] {
    return this.attachments.map((attachment) => pendingToPromptAttachment(attachment));
  }

  private effectiveAttachmentDelivery(): PromptAttachmentDelivery {
    return effectivePromptAttachmentDelivery(this.attachmentDelivery, this.attachments);
  }

  private createEditor() {
    if (!this.editorHost || this.editor !== undefined) return;
    this.editor = new EditorView({
      parent: this.editorHost,
      state: EditorState.create({
        doc: this.draft,
        extensions: [
          history(),
          markdown(),
          indentOnInput(),
          indentUnit.of("  "),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping,
          drawSelection(),
          EditorView.contentAttributes.of((view) => inputAssistanceContentAttributes(view.state.sliceDoc(0, view.state.selection.main.head))),
          EditorView.domEventHandlers({
            keyup: (event) => this.handleEditorKeyUp(event),
            blur: () => this.resetEditorModifierState(),
          }),
          this.editorLabelsCompartment.of(this.editorLabels()),
          promptArgumentHintExtension,
          this.editableCompartment.of(EditorView.editable.of(!this.disabled)),
          this.readOnlyCompartment.of(EditorState.readOnly.of(this.disabled)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) this.updateDraft(update.state.doc.toString());
          }),
          keymap.of([
            { any: (view, event) => this.handleEditorKeyDown(event, view) },
            { key: "ArrowDown", run: () => this.moveCompletion(1) },
            { key: "ArrowUp", run: () => this.moveCompletion(-1) },
            { key: "Escape", run: () => this.closeCompletions() },
            { key: "Tab", run: (view) => this.handleEditorTab(view) },
            { key: "Shift-Tab", run: (view) => indentWithTab.shift?.(view) ?? false },
            { key: "Backspace", run: (view) => deleteMarkupBackward(view) },
            ...historyKeymap,
            ...defaultKeymap,
          ]),
        ],
      }),
    });
  }

  private editorLabels() {
    return [
      placeholder(createPromptPlaceholder),
      EditorView.contentAttributes.of({ "aria-placeholder": messages.t("placeholder"), "aria-label": messages.t("message") }),
    ];
  }

  private syncEditorDoc() {
    const editor = this.editor;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current === this.draft) return;
    editor.dispatch({
      changes: { from: 0, to: current.length, insert: this.draft },
      selection: EditorSelection.cursor(this.draft.length),
    });
  }

  private updateEditorDisabledState() {
    this.editor?.dispatch({
      effects: [
        this.editableCompartment.reconfigure(EditorView.editable.of(!this.disabled)),
        this.readOnlyCompartment.reconfigure(EditorState.readOnly.of(this.disabled)),
      ],
    });
  }

  private updateDraft(value: string) {
    this.draft = value;
    const key = draftStorageKey(this.machineId, this.sessionId);
    if (key !== undefined) saveDraft(key, this.draft);
    const nextInputMode = inputModeForDraft(this.draft);
    if (!inputModesEqual(nextInputMode, this.currentInputMode)) this.currentInputMode = nextInputMode;
    void this.refreshCompletions();
  }

  private async refreshCompletions() {
    const trigger = this.currentTrigger();
    const version = ++this.requestVersion;
    this.selectedIndex = 0;
    if (trigger === undefined) {
      if (this.completions.length > 0) this.completions = [];
      return;
    }
    if (trigger.kind === "command" && this.sessionId !== undefined && this.sessionId !== "" && this.cwd !== undefined && this.cwd !== "") {
      const commands = await api.commands({ id: this.sessionId, cwd: this.cwd }, this.machineId).catch(emptySlashCommands);
      if (version !== this.requestVersion) return;
      this.completions = commands
        .filter((command) => command.name.toLowerCase().includes(trigger.query.toLowerCase()))
        .map((command) => ({
          kind: "command",
          replaceFrom: trigger.from,
          replaceTo: trigger.to,
          insertText: `/${command.name}`,
          detail: command.source,
          ...(command.description === undefined ? {} : { description: command.description }),
          ...(command.argumentHint === undefined ? {} : { argumentHint: command.argumentHint }),
        }));
    } else if (trigger.kind === "file" && this.projectId !== undefined && this.workspaceId !== undefined) {
      const files = await api.files(trigger.query, { scope: trigger.fileScope, machineId: this.machineId, projectId: this.projectId, workspaceId: this.workspaceId }).catch(emptyFileSuggestions);
      if (version !== this.requestVersion) return;
      this.completions = files
        .slice(0, 12)
        .map((file) => {
          const insertText = fileCompletionInsertText(file.path, trigger.quoted === true, file.path.endsWith("/") ? trigger.allPrefix : undefined);
          return {
            kind: "file",
            replaceFrom: trigger.from,
            replaceTo: trigger.to,
            insertText,
            detail: file.kind,
            ...(file.path.endsWith("/") && insertText.endsWith("\"") ? { cursorOffset: insertText.length - 1 } : {}),
          };
        });
    } else if (trigger.kind === "model" && this.sessionId !== undefined && this.sessionId !== "" && this.cwd !== undefined && this.cwd !== "") {
      const models = await api.models({ id: this.sessionId, cwd: this.cwd }, this.machineId).then((response) => response.models).catch(emptySessionModels);
      if (version !== this.requestVersion) return;
      this.completions = modelCompletionChoices(models, trigger.query).map((choice) => ({
        kind: "model",
        replaceFrom: trigger.from,
        replaceTo: trigger.to,
        ...choice,
      }));
    }
  }

  private currentTrigger(): PromptCompletionTrigger | undefined {
    return detectPromptCompletionTrigger(this.draft, this.editor?.state.selection.main.head ?? this.draft.length);
  }

  private moveCompletion(delta: number): boolean {
    if (!this.completions.length) return false;
    this.selectedIndex = (this.selectedIndex + delta + this.completions.length) % this.completions.length;
    return true;
  }

  private closeCompletions(): boolean {
    // Dismissal also invalidates loads started while the previous menu was
    // visible, so a late response cannot reopen it after focus moved away.
    this.requestVersion += 1;
    if (!this.completions.length) return false;
    this.completions = [];
    return true;
  }

  /** The capture-phase app dispatcher must leave composer-owned keys to CodeMirror. */
  ownsKeyboardEvent(event: KeyboardEvent): boolean {
    if (this.editor === undefined || !event.composedPath().includes(this.editor.contentDOM)) return false;
    // Keep Enter/newline handling and IME composition inside the editor, too.
    return event.isComposing || this.editor.composing
      || (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey)
      || this.matchesSendShortcut(event);
  }

  private matchesSendShortcut(event: KeyboardEvent): boolean {
    const shiftKey = event.key === "Enter"
      ? shouldUsePromptEnterShiftShortcut(event.shiftKey, this.explicitShiftKeyActive, this.mobilePromptEnterMedia)
      : event.shiftKey;
    return matchesComposerSend({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey, isComposing: event.isComposing, target: event.target }, composerSendShortcut(this.shortcuts, this.mobilePromptEnterMedia));
  }

  private handleEditorKeyDown(event: KeyboardEvent, view: EditorView): boolean {
    if (event.key === "Shift") {
      this.explicitShiftKeyActive = true;
      return false;
    }
    if (event.defaultPrevented || event.isComposing || view.composing) return false;
    const send = this.matchesSendShortcut(event);
    const plainEnter = event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey
      && !shouldUsePromptEnterShiftShortcut(event.shiftKey, this.explicitShiftKeyActive, this.mobilePromptEnterMedia);
    this.explicitShiftKeyActive = false;
    if (plainEnter && this.completions.length) {
      const completion = this.completions[this.selectedIndex];
      if (completion !== undefined) this.pick(completion);
      return true;
    }
    if (send) {
      this.send(this.defaultSendBehavior());
      return true;
    }
    if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      return insertNewlineContinueMarkup(view) || insertNewlineAndIndent(view);
    }
    return false;
  }

  private handleEditorKeyUp(event: KeyboardEvent): boolean {
    if (event.key === "Shift") this.explicitShiftKeyActive = false;
    return false;
  }

  private resetEditorModifierState(): boolean {
    this.explicitShiftKeyActive = false;
    return false;
  }

  private handleEditorTab(view: EditorView): boolean {
    if (this.completions.length) {
      const completion = this.completions[this.selectedIndex];
      if (completion !== undefined) this.pick(completion);
      return true;
    }
    const trigger = this.currentTrigger();
    if (trigger?.kind === "file") {
      void this.refreshCompletions();
      return true;
    }
    return indentWithTab.run?.(view) ?? false;
  }

  private pick(item: CompletionItem) {
    const editor = this.editor;
    if (!editor) return;
    const suffix = item.kind === "file" && (item.insertText.endsWith("/") || item.cursorOffset !== undefined) ? "" : " ";
    const cursor = item.replaceFrom + (item.cursorOffset ?? item.insertText.length) + suffix.length;
    const replaceTo = item.insertText.endsWith("\"") && this.draft.slice(item.replaceTo).startsWith("\"") ? item.replaceTo + 1 : item.replaceTo;
    editor.dispatch({
      changes: { from: item.replaceFrom, to: replaceTo, insert: `${item.insertText}${suffix}` },
      selection: EditorSelection.cursor(cursor),
      scrollIntoView: true,
      ...(item.argumentHint === undefined || item.argumentHint === "" ? {} : { effects: setPromptArgumentHint.of({ pos: cursor, text: item.argumentHint }) }),
    });
    this.completions = [];
  }

  private defaultSendBehavior(): "steer" | "followUp" | undefined {
    if (this.isCompacting) return "followUp";
    return this.canSteer ? this.defaultStreamingBehavior : undefined;
  }

  private send(streamingBehavior?: "steer" | "followUp") {
    if (this.disabled || this.sending || this.chipSendingKey === this.composerKey()) return;
    const text = this.draft.trim();
    const pending = this.attachments;
    const chips = this.promptChips;
    if (text === "" && pending.length === 0 && chips.length === 0) return;
    const behavior = this.canSteer || this.isCompacting ? streamingBehavior : undefined;
    const attachments = pending.length > 0 ? this.currentAttachments() : undefined;
    const delivery = this.effectiveAttachmentDelivery();
    // Folder delivery sends the displayed workspace-effective folder explicitly
    // (the uploads pattern): the save lands exactly where the label pointed,
    // independent of how the session cwd would resolve its own project config.
    const folder = attachments !== undefined && delivery === "folder" ? this.attachmentsFolder : undefined;
    if (chips.length > 0) {
      void this.sendWithChips(text, behavior, attachments, attachments === undefined ? undefined : delivery, folder, chips);
      return;
    }
    this.cancelVoiceInput();
    this.resetComposer();
    // Sending is owned by the controller (it drives the chat activity dock and,
    // for folder mode, orchestrates the upload + reference rewrite), so this is
    // fire-and-forget here.
    void this.onSend?.(text, behavior, attachments, attachments === undefined ? undefined : delivery, folder);
  }

  private composerKey(): string {
    return machineSessionKey(this.machineId, this.sessionId ?? "");
  }

  private async sendWithChips(text: string, behavior: "steer" | "followUp" | undefined, attachments: PromptAttachment[] | undefined, delivery: PromptAttachmentDelivery | undefined, folder: string | undefined, chips: readonly StagedPromptChip[]): Promise<void> {
    const key = this.composerKey();
    const draft = this.draft;
    const pending = this.attachments;
    this.chipSendingKey = key;
    this.chipError = undefined;
    try {
      const accepted = await this.onSend?.(text, behavior, attachments, delivery, folder, chips);
      if (key !== this.composerKey() || !this.isConnected) return;
      if (accepted === true) {
        // Do not erase edits made during delivery, or the next conversation.
        if (draft === this.draft && pending === this.attachments) this.resetComposer();
      } else {
        this.chipError = { kind: "retry" };
      }
    } catch (error) {
      if (key === this.composerKey()) this.chipError = { kind: "failed", error: String(error) };
    } finally {
      if (this.chipSendingKey === key) this.chipSendingKey = undefined;
    }
  }

  private resetComposer() {
    this.draft = "";
    this.currentInputMode = { kind: "normal" };
    const key = draftStorageKey(this.machineId, this.sessionId);
    if (key !== undefined) {
      clearDraft(key);
      clearStagedAttachments(key);
    }
    this.completions = [];
    this.attachments = [];
    this.attachmentError = undefined;
    // `draft` is not reactive, so the cleared text will not flow to CodeMirror
    // via `updated()`; push it to the editor document explicitly.
    this.syncEditorDoc();
  }

  static override styles = [promptEditorStyles, css`
    .voice-input-controls { display: flex; flex: 0 0 auto; align-items: center; gap: 6px; }
    .voice-language { box-sizing: border-box; width: 86px; height: 36px; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 0 7px; font: 13px system-ui, sans-serif; }
    .voice-language:disabled { opacity: .5; cursor: not-allowed; }
    .voice-input-button.voice-input-active { border-color: var(--pi-danger); color: var(--pi-danger); }
    .voice-input-button .voice-stop-mark { fill: currentColor; stroke: none; }
    .voice-input-feedback { min-width: 0; overflow: hidden; color: var(--pi-muted); font-size: 12px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; padding: 0 10px; }
    .voice-input-guidance { white-space: normal; }
    .voice-input-error { color: var(--pi-danger); white-space: normal; }
    @media (max-width: 430px) {
      .voice-input-controls { gap: 4px; }
      .voice-language { width: 72px; height: 44px; padding: 0 4px; font-size: 12px; }
      .voice-input-button { width: 44px; height: 44px; }
    }
  `];
}

// The only `status` fields the template reads directly are the model identity
// and thinking level (shown in renderCompactStatus). Everything else the editor
// cares about (canSteer/canStop/isCompacting/sending) is passed as a separate
// property that Lit already diffs by value. Comparing just these fields lets us
// ignore the per-token status churn that does not change anything on screen.
function sessionStatusRenderEqual(a: SessionStatus | undefined, b: SessionStatus | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return a.model?.id === b.model?.id
    && a.model?.provider === b.model?.provider
    && a.thinkingLevel === b.thinkingLevel;
}

function draftStorageKey(machineId: unknown, sessionId: unknown): string | undefined {
  if (typeof machineId !== "string" || machineId === "") return undefined;
  if (typeof sessionId !== "string" || sessionId === "") return undefined;
  return machineSessionKey(machineId, sessionId);
}

function emptySlashCommands(): SlashCommand[] {
  return [];
}

function emptyFileSuggestions(): FileSuggestion[] {
  return [];
}

function emptySessionModels(): SessionModel[] {
  return [];
}

function filesFromDataTransfer(data: DataTransfer | null): File[] {
  if (data === null) return [];
  return Array.from(data.files);
}

function dataTransferHasFiles(data: DataTransfer): boolean {
  const items = Array.from(data.items);
  if (items.length > 0) return items.some((item) => item.kind === "file");
  return Array.from(data.types).includes("Files");
}

function pendingToPromptAttachment(attachment: PendingAttachment): PromptAttachment {
  if (attachment.kind === "image") {
    return { kind: "image", mimeType: attachment.mimeType, data: attachment.data, name: attachment.name };
  }
  return { kind: "file", mimeType: attachment.mimeType, data: attachment.data, name: attachment.name };
}

export function attachmentFolderDeliveryLabel(folder: string): string {
  return messages.t("folder", { folder });
}

function fileExtensionLabel(name: string): string {
  const trimmed = name.trim();
  const dotIndex = trimmed.lastIndexOf(".");
  if (dotIndex >= 0 && dotIndex < trimmed.length - 1) return trimmed.slice(dotIndex + 1, dotIndex + 5).toUpperCase();
  return messages.t("file");
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => { reject(reader.error ?? new Error("Failed to read file")); };
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") { reject(new Error("Unexpected file reader result")); return; }
      const commaIndex = result.indexOf(",");
      resolve(commaIndex === -1 ? result : result.slice(commaIndex + 1));
    };
    reader.readAsDataURL(file);
  });
}

const proseInputAssistanceAttributes: Record<string, string> = {
  spellcheck: "true",
  autocorrect: "on",
  autocapitalize: "sentences",
  writingsuggestions: "true",
  dir: "auto",
};

const codeLikeInputAssistanceAttributes: Record<string, string> = {
  spellcheck: "false",
  autocorrect: "off",
  autocapitalize: "off",
  writingsuggestions: "false",
  dir: "auto",
};

function inputAssistanceContentAttributes(draftBeforeCursor: string): Record<string, string> {
  // CodeMirror is optimized for code and disables these by default, but the chat prompt is usually prose.
  return inputModeForDraft(draftBeforeCursor).kind === "normal" ? proseInputAssistanceAttributes : codeLikeInputAssistanceAttributes;
}

