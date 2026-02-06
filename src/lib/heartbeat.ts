export const heartbeat = (
  fn: () => Promise<unknown>,
  interval: number,
): (() => void) => {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const schedule = () => {
    timeout = setTimeout(() => {
      fn().then(schedule, () => {});
    }, interval);
  };

  schedule();

  return () => {
    if (timeout !== undefined) {
      clearTimeout(timeout);
      timeout = undefined;
    }
  };
};
