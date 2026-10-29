"use client";

import dynamic from "next/dynamic";

// Client-only boundary: the city is a WebGL scene, never server-rendered.
const CityApp = dynamic(() => import("@/city/CityApp"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center">
      <div className="text-text-muted animate-pulse">Raising the city…</div>
    </div>
  ),
});

export function CityClient() {
  return <CityApp />;
}
