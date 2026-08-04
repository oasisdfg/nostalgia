import { ipcMain, BrowserWindow } from 'electron';
import type {
  IpcInvokeChannel,
  IpcRequest,
  IpcResponse,
  IpcEventChannel,
  IpcEvent,
} from '@shared/contracts/ipc';

/** Registers a typed request/response handler for one invoke channel. */
export function registerInvoke<C extends IpcInvokeChannel>(
  channel: C,
  handler: (req: IpcRequest<C>) => IpcResponse<C> | Promise<IpcResponse<C>>,
): void {
  ipcMain.handle(channel, (_event, req) => handler(req as IpcRequest<C>));
}

/** Pushes a typed event payload to a window's renderer. */
export function emitEvent<C extends IpcEventChannel>(
  win: BrowserWindow,
  channel: C,
  payload: IpcEvent<C>,
): void {
  win.webContents.send(channel, payload);
}

/** Pushes a typed event payload to every open window's renderer. */
export function broadcastEvent<C extends IpcEventChannel>(channel: C, payload: IpcEvent<C>): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}
