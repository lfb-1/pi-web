export type AttentionAlertPermission = NotificationPermission | "unsupported";

export interface AttentionAlert {
  id: string;
  title: string;
  message: string;
  severity: "warning" | "error";
}

export interface AttentionAlertBrowser {
  permission(): AttentionAlertPermission;
  requestPermission(): Promise<AttentionAlertPermission>;
  showNotification(alert: AttentionAlert): void;
  playSound(): void;
}

const MAX_SEEN_ALERTS = 256;

/**
 * Owns the browser-only side effects for live events that need a human reply.
 * Producers remain unaware of Notification/Web Audio APIs, and alert ids make
 * reconnect/replay frames harmless within one page lifetime.
 */
export class BrowserAttentionAlerts {
  private readonly seenIds = new Set<string>();

  constructor(private readonly browser: AttentionAlertBrowser = defaultAttentionAlertBrowser) {}

  permission(): AttentionAlertPermission {
    return this.browser.permission();
  }

  requestPermission(): Promise<AttentionAlertPermission> {
    return this.browser.requestPermission();
  }

  alert(alert: AttentionAlert): void {
    if (this.seenIds.has(alert.id)) return;
    this.remember(alert.id);
    this.browser.playSound();
    if (this.browser.permission() === "granted") this.browser.showNotification(alert);
  }

  private remember(id: string): void {
    this.seenIds.add(id);
    if (this.seenIds.size <= MAX_SEEN_ALERTS) return;
    const oldest = this.seenIds.values().next().value;
    if (typeof oldest === "string") this.seenIds.delete(oldest);
  }
}

export function browserAttentionAlertPermission(): AttentionAlertPermission {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

const defaultAttentionAlertBrowser: AttentionAlertBrowser = {
  permission: browserAttentionAlertPermission,
  requestPermission: async () => {
    if (typeof Notification === "undefined") return "unsupported";
    return Notification.requestPermission();
  },
  showNotification: (alert) => {
    try {
      new Notification(alert.title, {
        body: alert.message,
        tag: `pi-web-attention:${alert.id}`,
      });
    } catch (error) {
      console.warn("Failed to show PI WEB attention notification", error);
    }
  },
  playSound: () => { playBrowserAttentionSound(); },
};

function playBrowserAttentionSound(): void {
  if (typeof AudioContext === "undefined") return;
  let context: AudioContext;
  try {
    context = new AudioContext();
  } catch (error) {
    console.warn("Failed to initialize PI WEB attention sound", error);
    return;
  }

  const play = () => {
    try {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const startedAt = context.currentTime;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, startedAt);
      oscillator.frequency.setValueAtTime(1_175, startedAt + 0.12);
      gain.gain.setValueAtTime(0.0001, startedAt);
      gain.gain.exponentialRampToValueAtTime(0.14, startedAt + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.32);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.addEventListener("ended", () => { void context.close(); }, { once: true });
      oscillator.start(startedAt);
      oscillator.stop(startedAt + 0.33);
    } catch (error) {
      void context.close();
      console.warn("Failed to play PI WEB attention sound", error);
    }
  };

  if (context.state === "suspended") {
    void context.resume().then(play, (error: unknown) => {
      void context.close();
      console.warn("Browser blocked PI WEB attention sound", error);
    });
    return;
  }
  play();
}
