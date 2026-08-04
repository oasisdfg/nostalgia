import type { MediaAssetDTO } from '@shared/contracts/ipc';

export function MediaGallery({ media }: { media: MediaAssetDTO[] }) {
  if (media.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {media.map((m) => (
        <img
          key={m.id}
          src={m.localPath}
          alt={m.type}
          title={m.type}
          loading="lazy"
          className="h-24 rounded-md shadow-e1 object-cover"
        />
      ))}
    </div>
  );
}
