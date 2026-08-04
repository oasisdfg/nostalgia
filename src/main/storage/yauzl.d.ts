// Minimal ambient types for the subset of yauzl we use (no @types/yauzl installed).
// yauzl is a mature, zip64-capable, pure-JS unzip lib. MAIN PROCESS ONLY.
declare module 'yauzl' {
  import type { Readable } from 'node:stream';

  export interface Entry {
    fileName: string;
    uncompressedSize: number;
    compressedSize: number;
  }

  export interface ZipFile {
    entryCount: number;
    readEntry(): void;
    openReadStream(entry: Entry, callback: (err: Error | null, stream?: Readable) => void): void;
    close(): void;
    on(event: 'entry', listener: (entry: Entry) => void): this;
    on(event: 'end', listener: () => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'close', listener: () => void): this;
  }

  export interface OpenOptions {
    lazyEntries?: boolean;
    autoClose?: boolean;
  }

  export function open(
    path: string,
    options: OpenOptions,
    callback: (err: Error | null, zipfile?: ZipFile) => void,
  ): void;
}
