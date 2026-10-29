import { useRef, useMemo, useEffect, createContext, useContext, useCallback } from 'react';
import { Canvas, addAfterEffect, useFrame, useThree } from '@react-three/fiber';
import { CameraControls, Environment, Lightformer, Stars } from '@react-three/drei';
import { EffectComposer, Bloom, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import CameraControlsImpl from 'camera-controls';
import * as THREE from 'three';
import { HexGrid } from './HexGrid';
import { GhostHexes } from './GhostHexes';
import { CloudLayer } from './CloudLayer';
import { SelectionIndicator } from './SelectionIndicator';
import { DayNightController } from './DayNightController';
import { ParticleEffects } from './ParticleEffects';
import { GroundPlane } from './GroundPlane';
import { TrafficSystem } from './TrafficSystem';
import { FloatingInspector } from './FloatingInspector';
import { HoverTooltip } from './HoverTooltip';
import { useAnimations } from '../../three/useAnimations';
import { useCinematicCamera } from '../../three/useCinematicCamera';
import { useAnimationStore } from '../../stores/useAnimationStore';
import { useUiModeStore } from '../../stores/useUiModeStore';
import { useMapStore } from '../../stores/useMapStore';
import { useCinematicStore } from '../../stores/useCinematicStore';
import { useGrid } from '../../hooks/useGrid';
import type { Kit } from '../../types/kit';
import { parseCellKey } from '../../utils/gridMath';

export type SceneMode = 'builder' | 'viewer';

/** Syncs the R3F camera to an external ref so it can be used outside the Canvas */
function CameraSync({ cameraRef }: { cameraRef: React.MutableRefObject<THREE.Camera | null> }) {
  const { camera } = useThree();
  cameraRef.current = camera;
  return null;
}

const TARGET_FPS = 30;

/** Caps the render loop at TARGET_FPS while keeping the scene alive (the city
 *  is contemplative — 30 fps halves the permanent CPU/GPU cost).
 *  - Metronome: invalidates every 1/30 s so all useFrame animations keep
 *    moving (deltas come from the untouched R3F clock, so delta-based speeds
 *    are unchanged).
 *  - Governor: drei CameraControls re-invalidates from inside its own
 *    useFrame whenever the camera moved ('update' event) — with the cinematic
 *    orbit active that would chain renders at full display rate. Zeroing
 *    `internal.frames` (a typed-but-undocumented fiber internal; verified
 *    against fiber 9.6.1's loop) after each rendered frame breaks that chain.
 *    Out-of-frame invalidations — React commits from WS frames, pointer
 *    drags, hover — still render on the very next rAF, so state changes stay
 *    immediate and dragging stays display-rate. If a future fiber upgrade
 *    changes the internal, the worst case is losing the cap only while the
 *    camera is moving. */
function FrameLimiter() {
  const invalidate = useThree((s) => s.invalidate);
  const get = useThree((s) => s.get);
  useEffect(() => {
    const interval = 1000 / TARGET_FPS;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last >= interval) {
        last = now - ((now - last) % interval); // stable cadence, no drift
        invalidate();
      }
    };
    raf = requestAnimationFrame(tick);
    const removeGovernor = addAfterEffect(() => {
      get().internal.frames = 0;
    });
    return () => {
      cancelAnimationFrame(raf);
      removeGovernor();
    };
  }, [invalidate, get]);
  return null;
}

const SHADOW_UPDATE_INTERVAL = 1 / 10; // ~every 3rd rendered frame at 30 fps

/** With `shadowMap.autoUpdate = false` (set on the Canvas), the sun's shadow
 *  map is recomputed only every SHADOW_UPDATE_INTERVAL seconds instead of on
 *  every frame. Moving casters (windmill blades, the day/night sun) still
 *  refresh at ~10 Hz — raise to 1/15 if blade shadows visibly strobe. Runs at
 *  default useFrame priority, before the composer's priority-1 render, so the
 *  flag is consumed in the same frame. */
function ShadowCadence() {
  const gl = useThree((s) => s.gl);
  const acc = useRef(Infinity); // Infinity → guaranteed update on the first frame
  useFrame((_, delta) => {
    acc.current += delta;
    if (acc.current >= SHADOW_UPDATE_INTERVAL) {
      acc.current = 0;
      gl.shadowMap.needsUpdate = true;
    }
  });
  return null;
}

type AnimType = 'windmillFans' | 'watermillWheels' | 'clouds' | 'trees' | 'boats' | 'flags' | 'waterTiles';

export interface AnimationRegistry {
  windmillFans: THREE.Object3D[];
  watermillWheels: THREE.Object3D[];
  clouds: THREE.Object3D[];
  trees: THREE.Object3D[];
  boats: THREE.Object3D[];
  flags: THREE.Object3D[];
  waterTiles: THREE.Object3D[];
}

interface AnimationContextValue {
  register: (type: AnimType, obj: THREE.Object3D) => void;
  unregister: (type: AnimType, obj: THREE.Object3D) => void;
  villageLightsRef: React.RefObject<THREE.PointLight[]>;
  daylightRef: React.RefObject<number>;
  registryRef: React.RefObject<AnimationRegistry>;
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
  cameraControlsRef: React.RefObject<CameraControlsImpl | null>;
}

export const AnimationContext = createContext<AnimationContextValue>(null!);
export const useAnimationContext = () => useContext(AnimationContext);

function SceneInner({ mode }: { mode: SceneMode }) {
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const fillRef = useRef<THREE.DirectionalLight>(null);
  const ambientRef = useRef<THREE.AmbientLight>(null);

  const { villageLightsRef, daylightRef, registryRef, cameraControlsRef } = useAnimationContext();
  const cameraControlsLocalRef = useRef<CameraControlsImpl>(null);
  const cloudsEnabled = useAnimationStore((s) => s.cloudsEnabled);
  const kit = useGrid().kit;

  // Sync local camera-controls ref to context
  if (cameraControlsLocalRef.current && cameraControlsRef.current !== cameraControlsLocalRef.current) {
    (cameraControlsRef as React.MutableRefObject<CameraControlsImpl | null>).current = cameraControlsLocalRef.current;
  }

  useAnimations(registryRef);
  useCinematicCamera(cameraControlsLocalRef);

  const dayNightRefs = useMemo(
    () => ({
      sun: sunRef,
      hemisphere: hemiRef,
      fill: fillRef,
      ambient: ambientRef,
      villageLights: villageLightsRef,
    }),
    [villageLightsRef],
  );

  // Colder, higher-contrast light set for the off-world colony; warm pastel
  // set for the medieval countryside. `key` forces light re-creation on kit
  // change so `args` take effect.
  const space = kit === 'space';

  return (
    <>
      <hemisphereLight
        key={`hemi-${kit}`}
        ref={hemiRef}
        args={space ? [0x223355, 0x111522, 0.35] : [0x87ceeb, 0x8b7355, 0.6]}
      />
      <directionalLight
        ref={sunRef}
        color={space ? 0xeef2ff : 0xfff4e0}
        intensity={space ? 1.5 : 1.2}
        position={[8, 12, 4]}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
        shadow-camera-near={0.5}
        shadow-camera-far={50}
        shadow-bias={-0.001}
      />
      <directionalLight
        ref={fillRef}
        color={space ? 0x4a6a9a : 0x8ec8f0}
        intensity={space ? 0.4 : 0.3}
        position={[-6, 4, -8]}
      />
      <ambientLight ref={ambientRef} color={0x404040} intensity={space ? 0.15 : 0.2} />

      <CameraControls
        ref={cameraControlsLocalRef}
        minDistance={6}
        maxDistance={30}
        minPolarAngle={Math.PI / 7}
        maxPolarAngle={Math.PI / 2.3}
        mouseButtons={{
          left: CameraControlsImpl.ACTION.NONE,
          right: CameraControlsImpl.ACTION.TRUCK,
          middle: CameraControlsImpl.ACTION.ROTATE,
          wheel: CameraControlsImpl.ACTION.DOLLY,
        }}
        touches={{
          one: CameraControlsImpl.ACTION.TOUCH_TRUCK,
          two: CameraControlsImpl.ACTION.TOUCH_DOLLY_TRUCK,
          three: CameraControlsImpl.ACTION.TOUCH_ROTATE,
        }}
      />

      <HexGrid />
      <TrafficSystem />
      {mode === 'builder' && <GhostHexes />}
      {/* Weather is a medieval thing — no clouds above an airless colony. */}
      {kit === 'medieval' && cloudsEnabled && <CloudLayer />}
      {space && <Stars radius={80} depth={40} count={4000} factor={4} saturation={0} fade />}
      <SceneAtmosphere kit={kit} />
      <GroundPlane mode={mode} />
      <DayNightController refs={dayNightRefs} daylightRef={daylightRef} />
      <ParticleEffects daylightRef={daylightRef} />
      {mode === 'builder' && <SelectionIndicator />}
      <ViewModeFloatingInspector />
      <HoverTooltip />
      <ViewModeFocus controlsRef={cameraControlsLocalRef} />
      <SceneEnv kit={kit} />
      <PostFX />
    </>
  );
}

/** Sets the scene background + fog for the current kit. Static `scene` Canvas
 *  props only apply at creation, so kit switches need this reactive setter.
 *  (When day/night is enabled, useDayNight keeps lerping these colours on top,
 *  with its own kit-aware palettes.) */
const ATMOSPHERE: Record<Kit, { bg: number; fogNear: number; fogFar: number }> = {
  medieval: { bg: 0xe9e2d3, fogNear: 30, fogFar: 70 },
  space: { bg: 0x0a0e1a, fogNear: 35, fogFar: 80 },
};

function SceneAtmosphere({ kit }: { kit: Kit }) {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const a = ATMOSPHERE[kit];
    scene.background = new THREE.Color(a.bg);
    scene.fog = new THREE.Fog(a.bg, a.fogNear, a.fogFar);
  }, [kit, scene]);
  return null;
}

/** In view mode, smoothly fly the camera to a freshly-selected resource cell
 *  so its floating popup is centred and legible. Empty/scenery cells aren't
 *  selectable in view mode, so this only fires for apps/addons. */
function ViewModeFocus({
  controlsRef,
}: {
  controlsRef: React.RefObject<CameraControlsImpl | null>;
}) {
  const uiMode = useUiModeStore((s) => s.mode);
  const selectedCell = useMapStore((s) => s.selectedCell);
  const grid = useGrid();

  useEffect(() => {
    if (uiMode !== 'view' || !selectedCell) return;
    const cell = useMapStore.getState().cells.get(selectedCell);
    if (!cell || (!cell.appId && !cell.addonId)) return;
    const controls = controlsRef.current;
    if (!controls) return;

    // A click doesn't emit 'controlstart', so the cinematic orbit (if active)
    // wouldn't otherwise stop — its per-frame loop would fight this zoom.
    useCinematicStore.getState().stop();

    const { q, r } = parseCellKey(selectedCell);
    const { x, z } = grid.cellToWorld(q, r);
    const y = cell.elevation ?? 0;
    const d = 11; // within the controls' min/max distance (6..30)
    void controls.setLookAt(
      x + d * 0.5,
      y + d * 0.85,
      z + d * 0.5,
      x,
      y + 1,
      z,
      true,
    );
  }, [uiMode, selectedCell, controlsRef, grid]);

  return null;
}

/** Soft studio IBL dome — the main brightener for the pastel look. Built from
 *  Lightformers (no remote HDRI fetch); lights every face evenly so there are
 *  no dark sides. `background={false}` keeps our scene background. The space
 *  variant is a dim cool dome so the colony reads as starkly sun-lit, not
 *  bathed in cream. `key` forces a rebake on kit change. */
function SceneEnv({ kit }: { kit: Kit }) {
  if (kit === 'space') {
    return (
      <Environment key="env-space" resolution={256} environmentIntensity={0.35} background={false}>
        <color attach="background" args={['#10141f']} />
        <Lightformer
          intensity={0.8}
          color="#cfe2ff"
          position={[0, 6, 0]}
          rotation-x={Math.PI / 2}
          scale={[12, 12, 1]}
        />
        <Lightformer intensity={0.3} color="#9fbce0" position={[6, 2, 4]} scale={[8, 8, 1]} />
        <Lightformer intensity={0.2} color="#7e9cc4" position={[-6, 2, -4]} scale={[8, 8, 1]} />
        <Lightformer
          intensity={0.15}
          color="#cfe2ff"
          position={[0, -4, 0]}
          rotation-x={-Math.PI / 2}
          scale={[12, 12, 1]}
        />
      </Environment>
    );
  }
  return (
    <Environment key="env-medieval" resolution={256} environmentIntensity={0.5} background={false}>
      {/* soft warm cream dome — gentle, not blown out */}
      <color attach="background" args={['#f0e9da']} />
      {/* big soft key from above */}
      <Lightformer
        intensity={1.1}
        color="#fff4e2"
        position={[0, 6, 0]}
        rotation-x={Math.PI / 2}
        scale={[12, 12, 1]}
      />
      {/* gentle warm side fills */}
      <Lightformer intensity={0.5} color="#fff1df" position={[6, 2, 4]} scale={[8, 8, 1]} />
      <Lightformer intensity={0.45} color="#ffe9d0" position={[-6, 2, -4]} scale={[8, 8, 1]} />
      {/* faint ground bounce so undersides aren't black */}
      <Lightformer
        intensity={0.25}
        color="#fff4e2"
        position={[0, -4, 0]}
        rotation-x={-Math.PI / 2}
        scale={[12, 12, 1]}
      />
    </Environment>
  );
}

/** Post-processing for the soft pastel look: a touch of bloom + Neutral tone
 *  mapping (preserves the palette's hues). AA is composer MSAA. No vignette —
 *  the references are bright and airy edge-to-edge.
 *
 *  NO depth-texture-consuming pass (N8AO, SMAA) is used. With this
 *  @react-three/postprocessing 3.x + postprocessing 6.x, ANY such pass makes
 *  the EffectComposer engage its depth machinery and run a per-frame depth
 *  `blitFramebuffer` (RenderPass.needsDepthBlit → blitDepthBuffer) whose
 *  read/write depth-stencil attachments alias — `GL_INVALID_OPERATION:
 *  glBlitFramebuffer: Read and write depth stencil attachments cannot be the
 *  same image` flooding the console every frame. Verified by headless bisect:
 *  Bloom+ToneMapping (and MSAA) are clean; adding SMAA or N8AO floods. So AA is
 *  done with `multisampling` (MSAA needs no depth texture) instead of SMAA.
 *  `multisampling={2}` only lowers the MSAA sample count (GPU saving) — same
 *  pass topology, still no depth machinery. */
function PostFX() {
  return (
    <EffectComposer multisampling={2}>
      <Bloom intensity={0.08} luminanceThreshold={0.92} luminanceSmoothing={0.3} mipmapBlur />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
    </EffectComposer>
  );
}

/** Renders the FloatingInspector only when uiMode === 'view'. Kept inside
 *  the r3f tree so drei's <Html> can project to screen coordinates. */
function ViewModeFloatingInspector() {
  const uiMode = useUiModeStore((s) => s.mode);
  if (uiMode !== 'view') return null;
  return <FloatingInspector />;
}

export function SceneCanvas({ mode, cameraRef }: { mode: SceneMode; cameraRef?: React.MutableRefObject<THREE.Camera | null> }) {
  const villageLightsRef = useRef<THREE.PointLight[]>([]);
  const daylightRef = useRef(1);
  const internalCameraRef = useRef<THREE.Camera | null>(null);
  const usedCameraRef = cameraRef ?? internalCameraRef;
  const cameraControlsRef = useRef<CameraControlsImpl | null>(null);

  const registryRef = useRef<AnimationRegistry>({
    windmillFans: [],
    watermillWheels: [],
    clouds: [],
    trees: [],
    boats: [],
    flags: [],
    waterTiles: [],
  });

  const register = useCallback((type: AnimType, obj: THREE.Object3D) => {
    const arr = registryRef.current[type];
    if (!arr.includes(obj)) arr.push(obj);
  }, []);

  const unregister = useCallback((type: AnimType, obj: THREE.Object3D) => {
    const arr = registryRef.current[type];
    const idx = arr.indexOf(obj);
    if (idx >= 0) arr.splice(idx, 1);
  }, []);

  const contextValue = useMemo(
    () => ({ register, unregister, villageLightsRef, daylightRef, registryRef, cameraRef: usedCameraRef, cameraControlsRef }),
    [register, unregister, usedCameraRef],
  );

  return (
    <AnimationContext.Provider value={contextValue}>
      <Canvas
        // PCFSoftShadowMap is what the boolean `shadows` enabled before;
        // autoUpdate=false hands the shadow refresh to <ShadowCadence /> so
        // the 1024² map isn't recomputed on every frame.
        shadows={{ type: THREE.PCFSoftShadowMap, autoUpdate: false }}
        // Demand mode + <FrameLimiter /> caps rendering at TARGET_FPS. React
        // commits (WS-driven state changes) auto-invalidate, so reactivity is
        // immediate; only the idle/ambient redraw rate is reduced.
        frameloop="demand"
        dpr={[1, 1.25]}
        gl={{
          // AA + tone mapping are handled by the EffectComposer (MSAA via its
          // `multisampling`, Neutral tone mapping effect). The renderer itself
          // must NOT antialias or tone-map or it would be applied twice.
          antialias: false,
          toneMapping: THREE.NoToneMapping,
          powerPreference: 'high-performance',
        }}
        camera={{ fov: 45, near: 0.1, far: 100, position: [14, 12, 14] }}
        scene={{ background: new THREE.Color(0xe9e2d3), fog: new THREE.Fog(0xe9e2d3, 30, 70) }}
      >
        <FrameLimiter />
        <ShadowCadence />
        <CameraSync cameraRef={usedCameraRef} />
        <SceneInner mode={mode} />
      </Canvas>
    </AnimationContext.Provider>
  );
}
