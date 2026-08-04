import type {
  IpcInvokeChannel,
  IpcEventChannel,
  IpcInvokeMap,
  IpcEventMap,
} from '@shared/contracts/ipc';

declare global {
  interface Window {
    nostalgia: {
      invoke<C extends IpcInvokeChannel>(
        channel: C,
        request: IpcInvokeMap[C]['request'],
      ): Promise<IpcInvokeMap[C]['response']>;
      on<C extends IpcEventChannel>(
        channel: C,
        callback: (payload: IpcEventMap[C]) => void,
      ): () => void;
    };
  }
}

export {};
