import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC_INVOKE_CHANNELS,
  IPC_EVENT_CHANNELS,
  type IpcInvokeChannel,
  type IpcEventChannel,
  type IpcInvokeMap,
  type IpcEventMap,
} from '@shared/contracts/ipc';

const invokeChannels = new Set<string>(IPC_INVOKE_CHANNELS);
const eventChannels = new Set<string>(IPC_EVENT_CHANNELS);

// The one and only object exposed to the renderer. No raw ipcRenderer, no Node.
const api = {
  invoke<C extends IpcInvokeChannel>(
    channel: C,
    request: IpcInvokeMap[C]['request'],
  ): Promise<IpcInvokeMap[C]['response']> {
    if (!invokeChannels.has(channel)) {
      return Promise.reject(new Error(`Blocked invoke on unknown channel: ${String(channel)}`));
    }
    return ipcRenderer.invoke(channel, request);
  },
  on<C extends IpcEventChannel>(channel: C, callback: (payload: IpcEventMap[C]) => void): () => void {
    if (!eventChannels.has(channel)) {
      throw new Error(`Blocked subscription on unknown channel: ${String(channel)}`);
    }
    const listener = (_event: IpcRendererEvent, payload: IpcEventMap[C]): void => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
};

export type NostalgiaBridge = typeof api;

contextBridge.exposeInMainWorld('nostalgia', api);
