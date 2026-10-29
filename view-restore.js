export const RESTORE_DELAY_MS = 10_000;

// Only user interactions call these methods. Automatic orbit updates must not
// reset the inactivity countdown or continually reset the camera.
export function createViewRestore(restore, delay = RESTORE_DELAY_MS) {
  let enabled = true;
  let interacting = false;
  let timer = null;
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    cancel();
    if (!enabled || interacting) return;
    timer = setTimeout(() => {
      timer = null;
      restore();
    }, delay);
  };
  return {
    cancel,
    start() { interacting = true; cancel(); },
    end() { interacting = false; schedule(); },
    adjusted: schedule,
    setEnabled(value) {
      enabled = value;
      if (enabled) schedule();
      else cancel();
    },
  };
}
