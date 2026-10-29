"use client";

import { useEffect } from "react";
import { TopBar } from "./components/layout/TopBar";
import { VersionBadge } from "./components/layout/VersionBadge";
import { BuilderLayout } from "./components/builder/BuilderLayout";
import { MayorPopup } from "./components/mayor/MayorPopup";
import { useMayorTips } from "./mayor/useMayorTips";
import { useMayorCityLoading } from "./mayor/useMayorCityLoading";
import { useAmbientMusic } from "./hooks/useAmbientMusic";
import { useAssetLoader } from "./hooks/useAssetLoader";
import { useAssetStore } from "./stores/useAssetStore";
import { useAuthStore } from "./stores/useAuthStore";
import { useMapStore } from "./stores/useMapStore";
import { useOrgStore } from "./stores/useOrgStore";
import { useWsClient } from "./ws/useWsClient";
import { KitPrompt } from "./components/builder/KitPrompt";
import { BuildingDrawer } from "@/overlays/BuildingDrawer";

/**
 * Root of the city shell. Resolves the authenticated session, loads assets, the
 * org list and the selected org's map, opens the live WebSocket, then renders
 * the 3D town (BuilderLayout → SceneCanvas) with the top bar and mayor popup.
 * (Composition ported from the mycctown App `Home`; auth via useAuthStore
 * instead of a react-router AuthGate.)
 */
export default function CityApp() {
  const authStatus = useAuthStore((s) => s.status);
  const refresh = useAuthStore((s) => s.refresh);

  useEffect(() => {
    if (authStatus === "idle") void refresh();
  }, [authStatus, refresh]);

  useEffect(() => {
    if (authStatus === "anonymous") {
      window.location.href = "/login";
    }
  }, [authStatus]);

  if (authStatus === "idle" || authStatus === "loading") {
    return <Splash text="Waking the watch…" />;
  }
  if (authStatus === "anonymous") {
    return <Splash text="Redirecting to sign in…" />;
  }
  if (authStatus === "error") {
    return <Splash text="Something went wrong. Reload to try again." />;
  }

  return <Home />;
}

function Home() {
  useAssetLoader();
  useAmbientMusic();
  const assetsReady = useAssetStore((s) => s.isLoaded);
  const assetProgress = useAssetStore((s) => s.loadingProgress);

  const orgsStatus = useOrgStore((s) => s.orgsStatus);
  const loadOrgs = useOrgStore((s) => s.loadOrgs);
  const currentOrgId = useOrgStore((s) => s.currentOrgId);
  const orgs = useOrgStore((s) => s.orgs);

  const mapCurrentOrgId = useMapStore((s) => s.currentOrgId);
  const mapLoadStatus = useMapStore((s) => s.loadStatus);
  const needsKitChoice = useMapStore((s) => s.needsKitChoice);
  const loadMapFromServer = useMapStore((s) => s.loadFromServer);

  useEffect(() => {
    if (orgsStatus === "idle") void loadOrgs();
  }, [orgsStatus, loadOrgs]);

  useEffect(() => {
    if (!currentOrgId) return;
    if (mapCurrentOrgId !== currentOrgId) {
      void loadMapFromServer(currentOrgId);
    }
  }, [currentOrgId, mapCurrentOrgId, loadMapFromServer]);

  useWsClient(currentOrgId);
  // Org-agnostic channel: rule firings + system events (bell/alerts).
  useWsClient("__system__");
  useMayorTips(currentOrgId);
  // Pinned "the realm takes stock…" notice until the city is coloured + reporting.
  useMayorCityLoading(currentOrgId);

  const currentOrg = orgs.find((o) => o.id === currentOrgId);

  return (
    <div className="flex h-full w-full flex-col">
      <TopBar />
      <main className="relative flex-1 overflow-hidden">
        {!currentOrg && (
          <EmptyState>
            {orgs.length === 0
              ? "No organisation found on your Clever Cloud account."
              : "Pick an organisation from the top bar."}
          </EmptyState>
        )}
        {currentOrg && mapLoadStatus === "loading" && (
          <EmptyState>Loading the town of {currentOrg.name}…</EmptyState>
        )}
        {currentOrg && mapLoadStatus === "error" && (
          <EmptyState>Failed to load the map.</EmptyState>
        )}
        {/* Fresh map: pick a style before anything is seeded or loaded. */}
        {currentOrg && mapLoadStatus === "ready" && needsKitChoice && <KitPrompt />}
        {/* Assets load only once the map's kit is known (useAssetLoader). */}
        {currentOrg && mapLoadStatus === "ready" && !needsKitChoice && !assetsReady && (
          <AssetsLoading progress={assetProgress} />
        )}
        {currentOrg && mapLoadStatus === "ready" && !needsKitChoice && assetsReady && (
          <BuilderLayout />
        )}
        <BuildingDrawer />
        <MayorPopup />
        <VersionBadge />
      </main>
    </div>
  );
}

function AssetsLoading({ progress }: { progress: number }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4">
      <div className="font-overtitle text-xs" style={{ color: "var(--cc-orange)" }}>
        Loading assets
      </div>
      <div className="h-1.5 w-64 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full"
          style={{ width: `${progress}%`, background: "var(--cc-gradient-red)" }}
        />
      </div>
      <div className="cc-muted text-xs">{progress.toFixed(0)}%</div>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="cc-muted flex h-full w-full items-center justify-center">{children}</div>;
}

function Splash({ text }: { text: string }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <div className="cc-muted animate-pulse">{text}</div>
    </div>
  );
}
