/**
 * The bridge to the desktop app (Electron). In a normal browser these fall back to web behaviour,
 * so the interface also runs with `npm run dev` for development.
 */
export interface VoiceInstallEvent { phase: "start" | "step" | "log" | "done" | "error"; step?: string; pct?: number; line?: string; message?: string }

interface ChalkBridge {
  isDesktop: true;
  version: string;
  platform: string;
  setTheme(theme: "light" | "dark"): void;
  saveFile(name: string, content: string): Promise<boolean>;
  openPath(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  voice: {
    status(): Promise<{ installed: boolean; installing: boolean; gpu: string | null }>;
    install(): Promise<{ ok: boolean; error?: string }>;
    onEvent(cb: (ev: VoiceInstallEvent) => void): () => void;
  };
  restartBackend(): Promise<void>;
  /** Print a document page (a /paper.html?… path) to PDF. save: ask where; open: open it in the PDF app. */
  docPdf?(req: { path: string; name: string; action: "save" | "open" }): Promise<{ ok: boolean; path?: string; error?: string }>;
}

declare global { interface Window { chalk?: ChalkBridge } }

export const desktop: ChalkBridge | null = window.chalk ?? null;
export const isDesktop = !!desktop;

export async function saveText(name: string, content: string, type = "text/markdown") {
  if (desktop) return desktop.saveFile(name, content);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return true;
}

export function openLink(url: string) {
  if (desktop) desktop.openExternal(url);
  else window.open(url, "_blank", "noopener");
}
