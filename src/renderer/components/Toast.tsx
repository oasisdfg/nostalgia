import { create } from 'zustand';
import { X } from 'lucide-react';

type Tone = 'error' | 'info';
export interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
}

interface ToastStore {
  toasts: ToastItem[];
  push: (message: string, tone?: Tone) => void;
  dismiss: (id: number) => void;
}

let seq = 1;

export const useToasts = create<ToastStore>((set) => ({
  toasts: [],
  push: (message, tone = 'error') => {
    const id = seq++;
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 6000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function ToastHost() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 max-w-[90vw] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start gap-2 rounded-md px-3 py-2 text-sm shadow-e3 animate-pop-in ${
            t.tone === 'error' ? 'bg-danger/15 text-fg' : 'bg-overlay text-fg'
          }`}
        >
          <span className="flex-1 break-words">{t.message}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="shrink-0 text-fg-faint transition-colors hover:text-fg"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
