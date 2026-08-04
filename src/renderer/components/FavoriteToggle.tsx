import { Heart } from 'lucide-react';
import { Focusable } from './Focusable';

/**
 * Heart toggle for adding a title to My List. Works for owned games and un-owned catalog
 * titles alike - the caller supplies the current state + a toggle handler. Focusable so
 * it's reachable by gamepad. Stops click propagation so it never triggers the card/row
 * behind it. Seamless per docs/UI-STYLE.md (no border; tinted surface + fill on active).
 */
export function FavoriteToggle({
  favorite,
  onToggle,
  size = 'md',
  label = 'My List',
}: {
  favorite: boolean;
  onToggle: () => void;
  size?: 'sm' | 'md';
  label?: string;
}) {
  const box = size === 'sm' ? 'h-7 w-7' : 'h-9 w-9';
  const icon = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  return (
    <Focusable
      ariaLabel={favorite ? `Remove from ${label}` : `Add to ${label}`}
      className="inline-flex rounded-full"
      onSelect={onToggle}
    >
      {/* Handle the click HERE and stop it: Focusable's own onClick sits on the parent
          wrapper, so a bare stopPropagation() would swallow the click before it ever
          reached onSelect (heart dead to the mouse). Gamepad enter still goes through
          Focusable's onEnterPress. */}
      <span
        title={favorite ? `Remove from ${label}` : `Add to ${label}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={`inline-flex ${box} cursor-pointer items-center justify-center rounded-full transition-colors ${
          favorite ? 'bg-accent/20 text-accent' : 'bg-black/65 text-fg/85 hover:bg-black/80 hover:text-fg'
        }`}
      >
        <Heart className={icon} fill={favorite ? 'currentColor' : 'none'} />
      </span>
    </Focusable>
  );
}
