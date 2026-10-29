import { useEffect, useRef } from 'react';
import { useMusicStore } from '../stores/useMusicStore';
import { useMapStore } from '../stores/useMapStore';
import { cdnUrl } from '../utils/cdn';

const MEDIEVAL_TRACKS = [
  'Castle Ember.mp3',
  'Castle Ember2.mp3',
  'Cobblestone Noon.mp3',
  'Cobblestone Noon2.mp3',
  'First Village.mp3',
  'First Village2.mp3',
];

const SPACE_TRACKS = [
  'Orbital Drift.mp3',
  'Orbital Drift2.mp3',
  'Dustline Drift.mp3',
  'Dustline Drift2.mp3',
  'Red Dust Launch.mp3',
];

/** Playlist follows the map's kit; null (loading) falls back to medieval. */
function tracksForKit(kit: string | null): string[] {
  return kit === 'space' ? SPACE_TRACKS : MEDIEVAL_TRACKS;
}

const VOLUME = 0.4;

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

function trackUrl(name: string): string {
  return cdnUrl(`music/${encodeURIComponent(name)}`);
}

export function useAmbientMusic(): void {
  const enabled = useMusicStore((s) => s.enabled);
  const setCurrentTrack = useMusicStore((s) => s.setCurrentTrack);
  const kit = useMapStore((s) => s.kit);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bagRef = useRef<string[]>([]);
  const lastPlayedRef = useRef<string | null>(null);
  // Current playlist, kept in a ref so the long-lived audio element always
  // shuffles from the active kit's pool without recreating the <audio>.
  const tracksRef = useRef<string[]>(tracksForKit(kit));
  tracksRef.current = tracksForKit(kit);

  useEffect(() => {
    const pickNext = (): string => {
      if (bagRef.current.length === 0) {
        const fresh = shuffle(tracksRef.current);
        // avoid immediate repeat across cycle boundary
        if (fresh.length > 1 && fresh[0] === lastPlayedRef.current) {
          const tmp = fresh[0]!;
          fresh[0] = fresh[1]!;
          fresh[1] = tmp;
        }
        bagRef.current = fresh;
      }
      const next = bagRef.current.shift()!;
      lastPlayedRef.current = next;
      return next;
    };

    const audio = new Audio();
    audio.volume = VOLUME;
    audio.preload = 'auto';
    const onEnded = () => {
      const next = pickNext();
      audio.src = trackUrl(next);
      setCurrentTrack(next);
      void audio.play().catch(() => {});
    };
    // A missing/broken track skips to the next one; once every track of the
    // current playlist has failed (no mp3s installed), give up and hide the
    // toggle instead of looping on 404s.
    const failed = new Set<string>();
    const onError = () => {
      const track = lastPlayedRef.current;
      if (!audio.src || !track) return;
      failed.add(track);
      if (tracksRef.current.every((t) => failed.has(t))) {
        audio.pause();
        setCurrentTrack(null);
        useMusicStore.getState().setUnavailable(true);
        return;
      }
      onEnded();
    };
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    audioRef.current = audio;
    return () => {
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    };
  }, [setCurrentTrack]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!enabled) {
      audio.pause();
      return;
    }

    if (!audio.src) {
      if (bagRef.current.length === 0) {
        bagRef.current = shuffle(tracksRef.current);
      }
      const next = bagRef.current.shift()!;
      lastPlayedRef.current = next;
      audio.src = trackUrl(next);
      setCurrentTrack(next);
    }

    let cancelled = false;
    const cleanupFns: Array<() => void> = [];

    void audio.play().catch(() => {
      // Browser blocked autoplay (typically after reload with enabled=true).
      // Retry on the next user gesture anywhere in the document.
      if (cancelled) return;
      const onInteract = () => {
        document.removeEventListener('pointerdown', onInteract);
        document.removeEventListener('keydown', onInteract);
        if (cancelled) return;
        void audio.play().catch(() => {});
      };
      document.addEventListener('pointerdown', onInteract);
      document.addEventListener('keydown', onInteract);
      cleanupFns.push(() => {
        document.removeEventListener('pointerdown', onInteract);
        document.removeEventListener('keydown', onInteract);
      });
    });

    return () => {
      cancelled = true;
      cleanupFns.forEach((fn) => fn());
    };
  }, [enabled, setCurrentTrack]);

  // Switch playlists when the map's kit flips (e.g. medieval ↔ space). Drop the
  // current bag/track so the next pick comes from the new pool; if music is
  // playing, cut over to a fresh track immediately. Skips the initial mount —
  // the play effect above handles the very first track.
  const prevKitRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (prevKitRef.current === undefined) {
      prevKitRef.current = kit;
      return;
    }
    if (prevKitRef.current === kit) return;
    prevKitRef.current = kit;

    bagRef.current = [];
    lastPlayedRef.current = null;

    const audio = audioRef.current;
    if (!audio) return;

    const fresh = shuffle(tracksForKit(kit));
    const next = fresh.shift()!;
    bagRef.current = fresh;
    lastPlayedRef.current = next;
    audio.src = trackUrl(next);
    setCurrentTrack(next);
    if (enabled) void audio.play().catch(() => {});
  }, [kit, enabled, setCurrentTrack]);
}
