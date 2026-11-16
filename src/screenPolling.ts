/** Poll only while visible; reset the interval and refresh immediately on return. */
export function startVisiblePolling(refresh: () => void, visibility: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> = document) {
  let interval: ReturnType<typeof setInterval> | undefined;
  const resume = () => {
    if (interval !== undefined) clearInterval(interval);
    interval = undefined;
    if (!visibility.hidden) {
      refresh();
      interval = setInterval(refresh, 60_000);
    }
  };
  resume();
  visibility.addEventListener('visibilitychange', resume);
  return () => {
    if (interval !== undefined) clearInterval(interval);
    visibility.removeEventListener('visibilitychange', resume);
  };
}
