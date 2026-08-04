import { useEffect } from 'react';
import { Monitor, ChevronLeft } from 'lucide-react';
import { FocusSection } from '@renderer/components/Focusable';
import { Button } from '@renderer/components/Button';
import { setFocus } from '@renderer/input/spatialNav';

/** Big Screen menu overlay (Start/Guide). Controller-navigable; B closes it. */
export function BigScreenMenu({ onResume, onExit }: { onResume: () => void; onExit: () => void }) {
  useEffect(() => {
    const r = requestAnimationFrame(() => setFocus('bs-menu'));
    return () => cancelAnimationFrame(r);
  }, []);

  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/70">
      <FocusSection focusKey="bs-menu" className="w-80 rounded-2xl bg-overlay p-6 shadow-e3 animate-pop-in">
        <h2 className="mb-4 text-xl font-semibold">Menu</h2>
        <div className="flex flex-col gap-2">
          <Button size="lg" variant="secondary" fullWidth icon={<ChevronLeft className="h-5 w-5" />} onClick={onResume}>
            Resume
          </Button>
          <Button size="lg" variant="secondary" fullWidth icon={<Monitor className="h-5 w-5" />} onClick={onExit}>
            Exit Big Screen
          </Button>
        </div>
      </FocusSection>
    </div>
  );
}
