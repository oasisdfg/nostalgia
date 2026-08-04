// Gamepad API input layer. W3C "standard" mapping - Xbox and DualShock/DualSense
// both report mapping:"standard" in Chromium/Electron, so one index table works.
// Directional input drives the SAME spatial-navigation engine as the keyboard via
// synthetic arrow keys; A/B map to Enter/Escape; bumpers + menu dispatch custom
// window events that Big Screen listens for.
//
// Standard button indices: 0=A/Cross 1=B/Circle 2=X/Square 3=Y/Triangle
// 4=LB/L1 5=RB/R1 6=LT/L2 7=RT/R2 8=View/Share 9=Menu/Options 10=L3 11=R3
// 12=Up 13=Down 14=Left 15=Right 16=Guide/PS. axes[0,1]=left stick X,Y.

const DIRS = [
  { name: 'up', key: 'ArrowUp', code: 38, button: 12 },
  { name: 'down', key: 'ArrowDown', code: 40, button: 13 },
  { name: 'left', key: 'ArrowLeft', code: 37, button: 14 },
  { name: 'right', key: 'ArrowRight', code: 39, button: 15 },
] as const;

const DEADZONE = 0.5;
const INITIAL_DELAY = 420;
const REPEAT_DELAY = 110;

/** Custom window events for non-directional gamepad actions (Big Screen listens). */
export const GP_EVENT = {
  prevSystem: 'gp:prevsystem',
  nextSystem: 'gp:nextsystem',
  menu: 'gp:menu',
} as const;

function fireKey(key: string, keyCode: number): void {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  // Chromium ignores keyCode from the init dict for synthetic events; force it.
  Object.defineProperty(event, 'keyCode', { get: () => keyCode });
  Object.defineProperty(event, 'which', { get: () => keyCode });
  window.dispatchEvent(event);
}

function fireEvent(type: string): void {
  window.dispatchEvent(new CustomEvent(type));
}

/** Starts the gamepad polling loop. Returns a stop function. */
export function startGamepad(): () => void {
  let raf = 0;
  const active: Record<string, boolean> = {};
  const nextFire: Record<string, number> = {};
  // Edge-triggered single-button actions (fire once per press).
  const prev: Record<number, boolean> = {};
  let prevMenu = false;

  const edges: { index: number; fire: () => void }[] = [
    { index: 0, fire: () => fireKey('Enter', 13) }, // A / Cross -> select/confirm
    { index: 1, fire: () => fireKey('Escape', 27) }, // B / Circle -> back
    { index: 4, fire: () => fireEvent(GP_EVENT.prevSystem) }, // LB / L1 -> previous system
    { index: 5, fire: () => fireEvent(GP_EVENT.nextSystem) }, // RB / R1 -> next system
  ];

  const loop = (): void => {
    // Read EVERY connected pad and merge their input. Reading only the first non-null
    // slot broke controller support whenever another device (wireless adapter, some
    // peripheral software's virtual pad) enumerated at a lower index than the real
    // controller - the idle device shadowed it and input "randomly" did nothing.
    const pads = Array.from(navigator.getGamepads ? navigator.getGamepads() : []).filter(
      (p): p is Gamepad => !!p,
    );
    if (pads.length > 0) {
      const now = performance.now();
      const anyBtn = (i: number): boolean => pads.some((gp) => !!gp.buttons[i]?.pressed);
      const anyAxis = (axis: number, dir: 1 | -1): boolean =>
        pads.some((gp) => ((gp.axes[axis] ?? 0) * dir) > DEADZONE);
      const isActive: Record<string, boolean> = {
        up: anyBtn(12) || anyAxis(1, -1),
        down: anyBtn(13) || anyAxis(1, 1),
        left: anyBtn(14) || anyAxis(0, -1),
        right: anyBtn(15) || anyAxis(0, 1),
      };
      for (const d of DIRS) {
        if (isActive[d.name]) {
          if (!active[d.name]) {
            fireKey(d.key, d.code);
            active[d.name] = true;
            nextFire[d.name] = now + INITIAL_DELAY;
          } else if (now >= (nextFire[d.name] ?? 0)) {
            fireKey(d.key, d.code);
            nextFire[d.name] = now + REPEAT_DELAY;
          }
        } else {
          active[d.name] = false;
        }
      }
      for (const e of edges) {
        const pressed = anyBtn(e.index);
        if (pressed && !prev[e.index]) e.fire();
        prev[e.index] = pressed;
      }
      // Menu: Start/Options (9) OR Guide/PS (16). Combined so both don't double-fire.
      // NOTE: the Guide/PS button (16) is often intercepted by the OS (Xbox Game Bar
      // on Windows) and may never reach the app - Start/Options (9) is the reliable one.
      const menuPressed = anyBtn(9) || anyBtn(16);
      if (menuPressed && !prevMenu) fireEvent(GP_EVENT.menu);
      prevMenu = menuPressed;
    }
    raf = requestAnimationFrame(loop);
  };

  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
}
