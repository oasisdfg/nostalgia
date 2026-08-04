import type {
  IpcInvokeChannel,
  IpcEventChannel,
  IpcInvokeMap,
  IpcEventMap,
} from '@shared/contracts/ipc';

/** Typed wrapper over the preload bridge for request/response channels. */
export function invoke<C extends IpcInvokeChannel>(
  channel: C,
  request: IpcInvokeMap[C]['request'],
): Promise<IpcInvokeMap[C]['response']> {
  return window.nostalgia.invoke(channel, request);
}

/** Typed wrapper over the preload bridge for push event channels. Returns an unsubscribe fn. */
export function on<C extends IpcEventChannel>(
  channel: C,
  callback: (payload: IpcEventMap[C]) => void,
): () => void {
  return window.nostalgia.on(channel, callback);
}
