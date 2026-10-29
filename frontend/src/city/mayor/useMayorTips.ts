import { useEffect, useRef } from 'react';
import { useMayorStore } from '../stores/useMayorStore';
import { useOrgStore } from '../stores/useOrgStore';
import { mayorTipMessages } from './mayorMessages';

/** Once-per-browser onboarding guard. */
const ONBOARDING_KEY = 'mycctown.mayor.tips';

function onboardingDone(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === 'done';
  } catch {
    return false;
  }
}

function markOnboardingDone(): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, 'done');
  } catch {
    // ignore
  }
}

/**
 * Proactive mayor tips, decoupled from the WS frame stream: a one-time (per
 * browser) onboarding nudge the first time a town loads. The per-org city-health
 * verdict (all-clear / trouble) is owned by useMayorCityLoading, which fires it
 * when the scene-loading notice resolves.
 *
 * Mount once near the app root and feed it the current org id.
 */
export function useMayorTips(orgId: string | null): void {
  // Tracks which org we've already run onboarding for, so switching away and
  // back doesn't re-fire and a re-render doesn't double-fire.
  const checkedOrg = useRef<string | null>(null);

  useEffect(() => {
    if (!orgId) {
      checkedOrg.current = null;
      return;
    }
    if (checkedOrg.current === orgId) return;
    checkedOrg.current = orgId;

    const mayor = useMayorStore.getState();
    if (!mayor.enabled) return;

    const orgName =
      useOrgStore.getState().orgs.find((o) => o.id === orgId)?.name ?? '';

    // One-time onboarding, only on the very first town a user opens. While the
    // loading notice is pinned these queue (hidden) behind it and surface once
    // it clears — see MayorPopup's pinned ?? current.
    if (!onboardingDone()) {
      markOnboardingDone();
      mayor.notify(mayorTipMessages.welcome(orgName));
      mayor.notify(mayorTipMessages.realtime());
    }
  }, [orgId]);
}
