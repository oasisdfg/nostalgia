import aIcon from '../GamePadButtons/XGamepad/Default/T_X_A_Color.png';
import bIcon from '../GamePadButtons/XGamepad/Default/T_X_B_Color.png';
import xIcon from '../GamePadButtons/XGamepad/Default/T_X_X_Color.png';
import yIcon from '../GamePadButtons/XGamepad/Default/T_X_Y_Color.png';
import lbIcon from '../GamePadButtons/XGamepad/Default/T_X_LB.png';
import rbIcon from '../GamePadButtons/XGamepad/Default/T_X_RB.png';
import dpadIcon from '../GamePadButtons/XGamepad/Default/T_X_Dpad.png';

// Map the logical hint glyph to an Xbox controller button image (the app's nav is
// Xbox-style: A/B + bumpers). Unmapped glyphs - e.g. ☰ Menu, which has no icon in
// the set - fall back to the text chip below.
const BUTTON_ICON: Record<string, string> = {
  A: aIcon,
  B: bIcon,
  X: xIcon,
  Y: yIcon,
  LB: lbIcon,
  RB: rbIcon,
  '✛': dpadIcon,
};

export interface ButtonHint {
  glyph: string;
  label: string;
  /** tailwind classes for the glyph chip (defaults to a neutral chip) */
  tone?: string;
  /** When set, the hint is also a mouse target (e.g. ☰ Menu now that Big Screen has no header). */
  onClick?: () => void;
}

function Hint({ glyph, tone, label, onClick }: ButtonHint) {
  const icon = BUTTON_ICON[glyph];
  const body = (
    <>
      {icon ? (
        <img src={icon} alt="" aria-hidden draggable={false} className="h-7 w-7 object-contain" />
      ) : (
        <span
          className={`grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-2xs font-bold ${tone ?? 'bg-surface-2 text-fg'}`}
        >
          {glyph}
        </span>
      )}
      <span>{label}</span>
    </>
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex cursor-pointer items-center gap-2 rounded-md transition-colors hover:text-fg"
    >
      {body}
    </button>
  ) : (
    <span className="inline-flex items-center gap-2">{body}</span>
  );
}

/** Controller hint bar for Big Screen Mode. Pass the hints for the current context. */
export function ButtonHints({ hints }: { hints: ButtonHint[] }) {
  return (
    <div className="flex items-center justify-center gap-8 bg-surface shadow-up px-6 py-3 text-sm text-fg-muted">
      {hints.map((h, i) => (
        <Hint key={i} {...h} />
      ))}
    </div>
  );
}
