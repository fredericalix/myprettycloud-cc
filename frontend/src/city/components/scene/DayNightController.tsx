import type { DayNightRefs } from '../../three/useDayNight';
import { useDayNight } from '../../three/useDayNight';

interface Props {
  refs: DayNightRefs;
  daylightRef: React.RefObject<number>;
}

export function DayNightController({ refs, daylightRef }: Props) {
  const internalDaylightRef = useDayNight(refs);

  // Sync daylight value to parent ref each frame via the hook
  // The useDayNight hook updates its own ref, so we sync it
  if (internalDaylightRef.current !== undefined) {
    (daylightRef as React.MutableRefObject<number>).current = internalDaylightRef.current;
  }

  return null;
}
