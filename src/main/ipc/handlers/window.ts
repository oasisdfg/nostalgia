import { z } from 'zod';
import { BrowserWindow } from 'electron';
import { registerInvoke } from '../registry';

const fullscreenSchema = z.object({ fullscreen: z.boolean() });

function appWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

export function registerWindowHandlers(): void {
  // Real OS fullscreen for Big Screen mode (the BrowserWindow is main-owned).
  registerInvoke('window:setFullscreen', (req) => {
    const p = fullscreenSchema.parse(req);
    const win = appWindow();
    if (win) win.setFullScreen(p.fullscreen);
    return { ok: true as const };
  });
}
