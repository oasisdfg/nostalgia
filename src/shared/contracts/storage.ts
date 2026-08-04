// Provider-agnostic remote storage + save-sync contract.
// Single source of truth for the StorageProvider abstraction.
// Imported by both main and renderer - TYPES ONLY, no Node/Electron imports.

export type HashAlgo = 'crc32' | 'md5' | 'sha1';

export interface HashRef {
  algo: HashAlgo;
  /** lowercase hex, no 0x prefix */
  value: string;
}

export interface ProviderCapabilities {
  providerId: string;
  supportsRanged: boolean;
  supportsHashManifest: boolean;
  supportsDirectUrl: boolean;
}

export interface RemoteEntry {
  /** opaque storage key, stored verbatim (may contain invisible Unicode) */
  key: string;
  isDirectory: boolean;
  sizeBytes: number | null;
}

export interface RemoteStat {
  key: string;
  sizeBytes: number | null;
  /** present only when the provider exposes a hash manifest */
  hashes: HashRef[];
}

export interface ProgressEvent {
  bytesReceived: number;
  bytesTotal: number | null;
  /** 0..1, or null when total is unknown */
  fraction: number | null;
  bytesPerSecond: number;
}

export interface DownloadOptions {
  /** opaque, verbatim absolute destination path */
  destPath: string;
  /** resume from this byte offset (ranged) when capabilities.supportsRanged */
  rangeStart?: number;
  /** validators captured at the last partial transfer; sent as If-Range on resume so a
   *  changed remote forces a clean full restart instead of a corrupt append */
  ifRange?: { etag?: string | null; lastModified?: string | null };
  onProgress?: (p: ProgressEvent) => void;
  signal?: AbortSignal;
}

export type DownloadOutcome = 'completed' | 'aborted';

export interface DownloadResult {
  outcome: DownloadOutcome;
  bytesWritten: number;
  /** server validators captured for later resume, when available */
  etag?: string | null;
  lastModified?: string | null;
}

export interface StorageProvider {
  getCapabilities(): ProviderCapabilities;
  list(prefix?: string): Promise<RemoteEntry[]>;
  stat(key: string): Promise<RemoteStat>;
  getDownloadUrl(key: string): Promise<string>;
  download(key: string, opts: DownloadOptions): Promise<DownloadResult>;
  verify(localPath: string, expected: HashRef): Promise<boolean>;

  /**
   * Whether this backend can provide a downloadable for a catalog game. Optional
   * capability - absent providers are treated as "no" (Download stays gated).
   */
  hasGame?(ref: { igdbId: number; name: string; platformId: number }): Promise<boolean>;
}

// Save-sync moved to its own provider abstraction - see @shared/contracts/saveSync.
