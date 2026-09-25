import * as THREE from 'three';
import './style.css';

type RoutePhase = 'outbound' | 'turnaround' | 'return' | 'earth-pause';
type RouteDirection = 'outbound' | 'return';

type PlanetSpec = {
  name: string;
  texture: string;
  anchorKeys: string[];
  radius: number;
  side: number;
  vertical: number;
  color: string;
  atmosphere?: string;
  clouds?: boolean;
  rings?: boolean;
  sun?: boolean;
};

type RouteEventDefinition = {
  key: string;
  name: string;
  approach: string;
  passed: string;
  returnApproach?: string;
  returnPassed?: string;
  window?: number;
};

type RouteEvent = {
  name: string;
  direction: RouteDirection;
  progress: number;
  approach: string;
  passed: string;
  window: number;
};

type GalaxySpriteRecord = {
  material: THREE.SpriteMaterial;
  visitProgresses: number[];
  fadeRange: number;
  maxOpacity: number;
};

type Meteor = {
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  velocity: THREE.Vector3;
  life: number;
};

type FlyingAsteroid = {
  mesh: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshStandardMaterial>;
  velocity: THREE.Vector3;
  life: number;
};

declare global {
  interface Window {
    __adelSpacePortfolioStarted?: boolean;
  }
}

const TEXTURE_ROOT = '/textures/';

/*
 * Falls das Skript in index.html versehentlich zweimal eingebunden ist,
 * wird nur die erste Instanz gestartet. Trotzdem sollte in index.html
 * nur ein einziges script.ts-Script-Tag stehen.
 */
if (window.__adelSpacePortfolioStarted) {
  console.warn(
    'Die Weltraumszene läuft bereits. Prüfe index.html auf doppelte script.ts-Einbindungen.',
  );
} else {
  window.__adelSpacePortfolioStarted = true;
  startSpacePortfolio();
}

function startSpacePortfolio(): void {
  const query = <T extends Element>(selector: string): T | null =>
    document.querySelector<T>(selector);

  const reducedMotionQuery = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  );
  const finePointer = window.matchMedia('(pointer: fine)').matches;

  const canvas = query<HTMLCanvasElement>('#space-scene');

  const routeName = query<HTMLElement>('#route-name');
  const routeDescription = query<HTMLElement>('#route-description');
  const missionTime = query<HTMLElement>('#mission-time');
  const routeProgressElement = query<HTMLElement>('.route-progress');
  const routeProgressFill = query<HTMLElement>('#route-progress-fill');

  const routeButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[data-route-index]'),
  );

  const speedSelect = query<HTMLSelectElement>('#travel-speed');
  const themeSelect = query<HTMLSelectElement>('#space-theme');

  const motionToggle = query<HTMLButtonElement>('#motion-toggle');
  const motionLabel = query<HTMLElement>('#motion-label');

  const cursorToggle = query<HTMLButtonElement>('#cursor-toggle');
  const cursorLabel = query<HTMLElement>('#cursor-label');
  const cursorElement = query<HTMLElement>('#black-hole-cursor');

  const assistantLauncher = query<HTMLButtonElement>('#assistant-launcher');
  const assistantPanel = query<HTMLElement>('#assistant-panel');
  const assistantClose = query<HTMLButtonElement>('#assistant-close');
  const assistantInput = query<HTMLInputElement>('#assistant-input');
  const assistantForm = query<HTMLFormElement>('#assistant-form');
  const assistantMessages = query<HTMLElement>('#assistant-messages');

  const menuToggle = query<HTMLButtonElement>('#menu-toggle');
  const siteNav = query<HTMLElement>('#site-nav');

  const currentYear = query<HTMLElement>('#current-year');

  const speedMultipliers: Record<string, number> = {
    slow: 0.58,
    normal: 1,
    fast: 1.75,
  };

  const OUTBOUND_DURATION_SECONDS = 360;
  const TURNAROUND_DURATION_SECONDS = 10;
  const RETURN_DURATION_SECONDS = 300;
  const EARTH_PAUSE_SECONDS = 2.5;

  const routeControlPoints: THREE.Vector3[] = [];
  const outboundControlIndexByKey = new Map<string, number>();
  const returnControlIndexByOutboundIndex = new Map<number, number>();
  const controlProgress: number[] = [];
  const routeSamples: THREE.Vector3[] = [];
  const routeEvents: RouteEvent[] = [];

  const planetGroups: Array<{
    group: THREE.Group;
    isSun: boolean;
    name: string;
    visitProgresses: number[];
  }> = [];

  const galaxySprites: GalaxySpriteRecord[] = [];
  const meteors: Meteor[] = [];
  const flyingAsteroids: FlyingAsteroid[] = [];

  const surfaceTextureCache = new Map<string, Promise<THREE.Texture>>();
  const galaxyTextureCache = new Map<string, Promise<THREE.Texture>>();

  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let routeCurve: THREE.CatmullRomCurve3 | null = null;
  let starPoints: THREE.Points | null = null;
  let galaxyFallbackTexture: THREE.CanvasTexture | null = null;
  let saturnRingTexture: THREE.CanvasTexture | null = null;

  let outboundEndControlIndex = 0;
  let farTurnEndControlIndex = 0;
  let outboundEndProgress = 0;
  let farTurnStartProgress = 0;
  let farTurnEndProgress = 0;
  let routeLength = 1;

  let speedMode = safeReadStorage('adel-space-speed') ?? 'normal';
  let spaceTheme: 'cinematic' | 'minimal' =
    safeReadStorage('adel-space-theme') === 'minimal'
      ? 'minimal'
      : 'cinematic';

  let travelProgress = 0;
  let elapsedSeconds = 0;
  let ambientSeconds = 0;
  let phase: RoutePhase = 'outbound';
  let phaseTimer = 0;
  let isPaused = reducedMotionQuery.matches;
  let motionControlUsed = false;
  let lastFrameTime = 0;
  let animationFrameId: number | null = null;
  let meteorCountdown = 6;
  let asteroidCountdown = 5;
  let lastHudState = '';
  let cursorEnabled = finePointer;

  const pointerTarget = new THREE.Vector2(0, 0);

  if (!Object.prototype.hasOwnProperty.call(speedMultipliers, speedMode)) {
    speedMode = 'normal';
  }

  if (speedSelect) speedSelect.value = speedMode;
  if (themeSelect) themeSelect.value = spaceTheme;

  document.body.dataset.spaceTheme = spaceTheme;
  document.documentElement.classList.add('js-ready');

  function safeReadStorage(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function safeWriteStorage(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Lokaler Speicher ist optional; die Seite funktioniert auch ohne ihn.
    }
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  function randomBetween(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  function smoothstep(edge0: number, edge1: number, value: number): number {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  /* ---------- Eine zusammenhängende Route mit Vorwärts-Rückflug ---------- */

  function horizontalSide(tangent: THREE.Vector3): THREE.Vector3 {
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    if (side.lengthSq() < 0.001) {
      side.set(1, 0, 0);
    }

    return side;
  }

  function addNamedPoint(key: string, point: THREE.Vector3): number {
    const index = routeControlPoints.length;
    routeControlPoints.push(point.clone());
    outboundControlIndexByKey.set(key, index);
    return index;
  }

  function appendTurnArc(
    center: THREE.Vector3,
    incomingDirection: THREE.Vector3,
    radius: number,
    steps: number,
  ): {
    offset: THREE.Vector3;
    midIndex: number;
    endIndex: number;
  } {
    const forward = incomingDirection.clone().normalize();
    const side = horizontalSide(forward);
    const midpointStep = Math.floor(steps / 2);

    let midIndex = routeControlPoints.length - 1;
    let endIndex = routeControlPoints.length - 1;
    let endPoint = center.clone();

    for (let step = 1; step <= steps; step += 1) {
      const angle = Math.PI * (step / steps);

      const point = center
        .clone()
        .addScaledVector(forward, radius * Math.sin(angle))
        .addScaledVector(side, radius * (1 - Math.cos(angle)));

      const pointIndex = routeControlPoints.length;
      routeControlPoints.push(point);
      endPoint = point;
      endIndex = pointIndex;

      if (step === midpointStep) {
        midIndex = pointIndex;
      }
    }

    return {
      offset: endPoint.clone().sub(center),
      midIndex,
      endIndex,
    };
  }

  function buildRouteGeometry(): void {
    routeControlPoints.length = 0;
    outboundControlIndexByKey.clear();
    returnControlIndexByOutboundIndex.clear();
    controlProgress.length = 0;
    routeSamples.length = 0;

    /*
     * Start an der Erde, Flug zur Sonne, Wendebogen und Vorwärtsflug
     * zurück zur Erde. Anschließend geht es nach außen ins Sonnensystem.
     */
    const start = new THREE.Vector3(0, 0, 58);
    const earthInbound = new THREE.Vector3(0, 0, 21);
    const venusInbound = new THREE.Vector3(-18, 3, -25);
    const mercuryInbound = new THREE.Vector3(-24, 1, -82);
    const sunApproach = new THREE.Vector3(0, 0, -170);

    addNamedPoint('start', start);
    addNamedPoint('earth-inbound', earthInbound);
    addNamedPoint('venus-inbound', venusInbound);
    addNamedPoint('mercury-inbound', mercuryInbound);
    addNamedPoint('sun-approach', sunApproach);

    const incomingToSun = sunApproach
      .clone()
      .sub(mercuryInbound)
      .normalize();

    const sunTurn = appendTurnArc(sunApproach, incomingToSun, 18, 14);

    outboundControlIndexByKey.set('sun-turn-middle', sunTurn.midIndex);
    outboundControlIndexByKey.set('sun-turn-end', sunTurn.endIndex);

    const sunTurnOffset = sunTurn.offset;

    addNamedPoint(
      'mercury-solar-return',
      mercuryInbound.clone().addScaledVector(sunTurnOffset, 0.92),
    );
    addNamedPoint(
      'venus-solar-return',
      venusInbound.clone().addScaledVector(sunTurnOffset, 0.65),
    );
    addNamedPoint(
      'earth-solar-return',
      earthInbound.clone().addScaledVector(sunTurnOffset, 0.34),
    );
    addNamedPoint(
      'earth-departure',
      earthInbound
        .clone()
        .addScaledVector(sunTurnOffset, 0.12)
        .add(new THREE.Vector3(0, 0, 58)),
    );

    addNamedPoint('mars', new THREE.Vector3(-22, 4, 160));
    addNamedPoint('asteroid-belt', new THREE.Vector3(0, 0, 245));
    addNamedPoint('jupiter', new THREE.Vector3(38, 5, 385));
    addNamedPoint('saturn', new THREE.Vector3(-40, -4, 575));
    addNamedPoint('uranus', new THREE.Vector3(34, 5, 800));
    addNamedPoint('neptune', new THREE.Vector3(-35, -4, 1050));
    addNamedPoint('kuiper-belt', new THREE.Vector3(2, 0, 1290));
    addNamedPoint('heliopause', new THREE.Vector3(0, 0, 1580));

    addNamedPoint('milky-way-edge', new THREE.Vector3(0, 9, 2070));
    addNamedPoint('magellanic-clouds', new THREE.Vector3(12, -2, 2700));
    addNamedPoint('local-group', new THREE.Vector3(-8, -9, 3370));
    addNamedPoint('andromeda', new THREE.Vector3(28, 8, 4090));
    addNamedPoint('triangulum', new THREE.Vector3(-22, 1, 4860));
    addNamedPoint('sombrero', new THREE.Vector3(13, -6, 5670));
    addNamedPoint('virgo-cluster', new THREE.Vector3(-3, 10, 6520));
    addNamedPoint('coma-cluster', new THREE.Vector3(24, -8, 7440));
    addNamedPoint('distant-field', new THREE.Vector3(-17, 6, 8380));
    addNamedPoint('far-end', new THREE.Vector3(0, 0, 9400));

    const outboundPoints = routeControlPoints.map((point) => point.clone());
    outboundEndControlIndex = outboundPoints.length - 1;

    const farEnd = outboundPoints[outboundEndControlIndex];
    const beforeFarEnd = outboundPoints[outboundEndControlIndex - 1];

    if (!farEnd || !beforeFarEnd) {
      throw new Error('Die Weltraumroute konnte nicht erstellt werden.');
    }

    const incomingToFarEnd = farEnd
      .clone()
      .sub(beforeFarEnd)
      .normalize();

    const farTurn = appendTurnArc(farEnd, incomingToFarEnd, 58, 20);

    farTurnEndControlIndex = farTurn.endIndex;

    returnControlIndexByOutboundIndex.set(
      outboundEndControlIndex,
      farTurnEndControlIndex,
    );

    /*
     * Der Rückkurs erhält eigene Wegpunkte in Vorwärtsrichtung.
     * Die kleine Seitenverschiebung trennt Hin- und Rückkurs räumlich.
     */
    for (let index = outboundPoints.length - 2; index >= 0; index -= 1) {
      const point = outboundPoints[index];
      if (!point) continue;

      const ratio = index / Math.max(outboundPoints.length - 1, 1);
      const returnIndex = routeControlPoints.length;

      returnControlIndexByOutboundIndex.set(index, returnIndex);

      routeControlPoints.push(
        point
          .clone()
          .addScaledVector(farTurn.offset, Math.pow(ratio, 0.92)),
      );
    }

    routeCurve = new THREE.CatmullRomCurve3(
      routeControlPoints.map((point) => point.clone()),
      false,
      'centripetal',
      0.42,
    );

    routeCurve.arcLengthDivisions = Math.max(
      5000,
      (routeControlPoints.length - 1) * 90,
    );
    routeCurve.updateArcLengths();

    const divisions = (routeControlPoints.length - 1) * 90;
    const cumulativeLengths = routeCurve.getLengths(divisions);
    const totalLength =
      cumulativeLengths[cumulativeLengths.length - 1] ?? 1;

    routeLength = Math.max(totalLength, 1);

    for (let index = 0; index < routeControlPoints.length; index += 1) {
      const lengthIndex = index * 90;
      controlProgress[index] =
        (cumulativeLengths[lengthIndex] ?? 0) / routeLength;
    }

    const sampleCount = 3200;

    for (let index = 0; index <= sampleCount; index += 1) {
      routeSamples.push(routeCurve.getPointAt(index / sampleCount));
    }

    outboundEndProgress =
      controlProgress[outboundEndControlIndex] ?? 0.5;
    farTurnStartProgress = outboundEndProgress;
    farTurnEndProgress =
      controlProgress[farTurnEndControlIndex] ?? outboundEndProgress + 0.01;
  }

  function getFrame(progress: number): {
    point: THREE.Vector3;
    tangent: THREE.Vector3;
    side: THREE.Vector3;
    up: THREE.Vector3;
  } {
    if (!routeCurve) {
      return {
        point: new THREE.Vector3(),
        tangent: new THREE.Vector3(0, 0, 1),
        side: new THREE.Vector3(1, 0, 0),
        up: new THREE.Vector3(0, 1, 0),
      };
    }

    const t = clamp(progress, 0.0001, 0.9999);
    const point = routeCurve.getPointAt(t);
    const tangent = routeCurve.getTangentAt(t).normalize();

    const side = new THREE.Vector3()
      .crossVectors(tangent, new THREE.Vector3(0, 1, 0))
      .normalize();

    if (side.lengthSq() < 0.001) {
      side.set(1, 0, 0);
    }

    const up = new THREE.Vector3()
      .crossVectors(side, tangent)
      .normalize();

    return { point, tangent, side, up };
  }

  function getProgressForKey(key: string): number | null {
    const index = outboundControlIndexByKey.get(key);
    if (index === undefined) return null;

    const progress = controlProgress[index];
    return progress === undefined ? null : progress;
  }

  function getReturnProgressForKey(key: string): number | null {
    const outboundIndex = outboundControlIndexByKey.get(key);
    if (outboundIndex === undefined) return null;

    const returnIndex =
      returnControlIndexByOutboundIndex.get(outboundIndex);
    if (returnIndex === undefined) return null;

    const progress = controlProgress[returnIndex];
    return progress === undefined ? null : progress;
  }

  function getVisitProgresses(keys: string[]): number[] {
    const visits: number[] = [];

    for (const key of keys) {
      const outboundProgress = getProgressForKey(key);

      if (outboundProgress !== null) {
        visits.push(outboundProgress);

        const returnProgress = getReturnProgressForKey(key);
        if (returnProgress !== null) {
          visits.push(returnProgress);
        }
      }
    }

    return [...new Set(visits)].sort((a, b) => a - b);
  }

  function getMinimumRouteDistance(candidate: THREE.Vector3): number {
    let minimumSquared = Number.POSITIVE_INFINITY;

    for (const point of routeSamples) {
      minimumSquared = Math.min(
        minimumSquared,
        candidate.distanceToSquared(point),
      );
    }

    return Math.sqrt(minimumSquared);
  }

  /*
   * Platzierung außerhalb des Flugwegs: Das Raumschiff fliegt an den
   * Planeten vorbei statt durch ihre Kugeln oder Saturns Ringe.
   */
  function findSafePlanetPosition(
    progress: number,
    spec: PlanetSpec,
  ): THREE.Vector3 {
    const frame = getFrame(progress);
    const ringExtent = spec.rings ? 2.2 : 1;
    const safeDistance = spec.radius * ringExtent + 5;
    const initialOffset = Math.max(
      spec.radius * ringExtent + spec.radius * 0.75,
      spec.radius * 2.25,
    );

    const angles = [
      0,
      0.34,
      -0.34,
      0.72,
      -0.72,
      1.08,
      -1.08,
      1.52,
      -1.52,
      2.15,
      -2.15,
      Math.PI,
    ];

    const radialSteps = [0, 0.45, 0.95, 1.6, 2.5, 3.5];

    let bestSafePosition: THREE.Vector3 | null = null;
    let bestSafeOffset = Number.POSITIVE_INFINITY;
    let bestFallbackPosition = frame.point.clone();
    let bestFallbackDistance = -1;

    for (const step of radialSteps) {
      const offset = initialOffset + spec.radius * step;

      for (const angle of angles) {
        const direction = frame.side
          .clone()
          .multiplyScalar(spec.side * Math.cos(angle))
          .addScaledVector(frame.up, Math.sin(angle))
          .normalize();

        const candidate = frame.point
          .clone()
          .addScaledVector(direction, offset);

        const routeDistance = getMinimumRouteDistance(candidate);

        if (routeDistance > bestFallbackDistance) {
          bestFallbackDistance = routeDistance;
          bestFallbackPosition = candidate;
        }

        if (
          routeDistance >= safeDistance &&
          offset < bestSafeOffset
        ) {
          bestSafeOffset = offset;
          bestSafePosition = candidate;
        }
      }
    }

    return bestSafePosition ?? bestFallbackPosition;
  }

  /* ---------- Planeten und Texturen: ein Objekt pro Planet ---------- */

  function loadSurfaceTexture(
    filename: string,
    kind: 'color' | 'mask' = 'color',
  ): Promise<THREE.Texture> {
    const cacheKey = `${kind}:${filename}`;
    const cached = surfaceTextureCache.get(cacheKey);

    if (cached) return cached;

    const promise = new Promise<THREE.Texture>((resolve, reject) => {
      new THREE.TextureLoader().load(
        `${TEXTURE_ROOT}${filename}`,
        (texture) => {
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.ClampToEdgeWrapping;
          texture.colorSpace =
            kind === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;

          const anisotropy =
            renderer?.capabilities.getMaxAnisotropy() ?? 1;
          texture.anisotropy = Math.min(anisotropy, 8);

          resolve(texture);
        },
        undefined,
        () => reject(new Error(`public/textures/${filename} nicht gefunden`)),
      );
    });

    surfaceTextureCache.set(cacheKey, promise);
    return promise;
  }

  function applySurfaceTexture(
    material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial,
    filename: string,
  ): void {
    void loadSurfaceTexture(filename)
      .then((texture) => {
        material.map = texture;
        material.color.set('#ffffff');
        material.needsUpdate = true;
      })
      .catch((error: unknown) => {
        console.warn(
          `Textur konnte nicht geladen werden: public/textures/${filename}`,
          error,
        );
      });
  }

  function createSaturnRingTexture(): THREE.CanvasTexture {
    const size = 1024;
    const ringCanvas = document.createElement('canvas');
    ringCanvas.width = size;
    ringCanvas.height = size;

    const context = ringCanvas.getContext('2d');
    if (!context) return new THREE.CanvasTexture(ringCanvas);

    const center = size / 2;

    for (let radius = 185; radius < 490; radius += 1) {
      const variation =
        Math.sin(radius * 0.17) * 0.5 +
        Math.cos(radius * 0.071) * 0.5;

      const gap =
        (radius > 300 && radius < 316) ||
        (radius > 354 && radius < 361) ||
        (radius > 415 && radius < 421);

      if (gap) continue;

      const alpha = clamp(
        0.22 + variation * 0.13 + Math.random() * 0.08,
        0.07,
        0.48,
      );

      context.beginPath();
      context.arc(center, center, radius, 0, Math.PI * 2);
      context.strokeStyle = `rgba(225, 209, 174, ${alpha})`;
      context.lineWidth = radius % 13 < 4 ? 2.8 : 1.25;
      context.stroke();
    }

    const texture = new THREE.CanvasTexture(ringCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  const planetSpecs: PlanetSpec[] = [
    {
      name: 'Erde',
      texture: 'earth.png',
      anchorKeys: ['earth-inbound', 'earth-solar-return'],
      radius: 4.8,
      side: 1,
      vertical: 0.08,
      color: '#397bb6',
      atmosphere: '#75cafa',
      clouds: true,
    },
    {
      name: 'Venus',
      texture: 'venus.png',
      anchorKeys: ['venus-inbound', 'venus-solar-return'],
      radius: 3.1,
      side: -1,
      vertical: 0.08,
      color: '#d79b5e',
      atmosphere: '#e2b579',
    },
    {
      name: 'Merkur',
      texture: 'mercury.png',
      anchorKeys: ['mercury-inbound', 'mercury-solar-return'],
      radius: 2.1,
      side: 1,
      vertical: -0.08,
      color: '#a69a8d',
    },
    {
      name: 'Sonne',
      texture: 'sun.png',
      anchorKeys: ['sun-approach', 'sun-turn-middle'],
      radius: 13,
      side: -1,
      vertical: 0,
      color: '#ffb755',
      sun: true,
    },
    {
      name: 'Mars',
      texture: 'mars.png',
      anchorKeys: ['mars'],
      radius: 2.8,
      side: -1,
      vertical: 0.12,
      color: '#ae5740',
    },
    {
      name: 'Jupiter',
      texture: 'jupiter.png',
      anchorKeys: ['jupiter'],
      radius: 10,
      side: 1,
      vertical: 0.1,
      color: '#bd9476',
    },
    {
      name: 'Saturn',
      texture: 'saturn.png',
      anchorKeys: ['saturn'],
      radius: 7.5,
      side: -1,
      vertical: 0.1,
      color: '#c9a873',
      rings: true,
    },
    {
      name: 'Uranus',
      texture: 'uranus.png',
      anchorKeys: ['uranus'],
      radius: 5.2,
      side: 1,
      vertical: -0.1,
      color: '#75bdca',
      rings: true,
    },
    {
      name: 'Neptun',
      texture: 'neptune.png',
      anchorKeys: ['neptune'],
      radius: 5.5,
      side: -1,
      vertical: 0.08,
      color: '#416fc0',
    },
  ];

  function getAverageAnchorProgress(keys: string[]): number {
    const progressValues = keys
      .map((key) => getProgressForKey(key))
      .filter((value): value is number => value !== null);

    if (progressValues.length === 0) return 0;

    return progressValues.reduce((sum, value) => sum + value, 0) /
      progressValues.length;
  }

  function addPlanet(spec: PlanetSpec): void {
    if (!scene) return;

    /*
     * Pro Planeten wird genau eine Group erzeugt. Bei Hin- und Rückflug
     * wird dieselbe Group anhand ihrer Besuchsfortschritte eingeblendet.
     */
    const visitProgresses = getVisitProgresses(spec.anchorKeys);
    if (visitProgresses.length === 0) return;

    const group = new THREE.Group();

    const material = spec.sun
      ? new THREE.MeshBasicMaterial({ color: spec.color })
      : new THREE.MeshStandardMaterial({
          color: spec.color,
          roughness: 0.92,
          metalness: 0,
        });

    applySurfaceTexture(material, spec.texture);

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(spec.radius, 80, 64),
      material,
    );

    sphere.userData['planetName'] = spec.name;
    group.add(sphere);

    if (spec.atmosphere) {
      group.add(
        new THREE.Mesh(
          new THREE.SphereGeometry(spec.radius * 1.055, 64, 48),
          new THREE.MeshBasicMaterial({
            color: spec.atmosphere,
            transparent: true,
            opacity: 0.1,
            side: THREE.BackSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        ),
      );
    }

    if (spec.clouds) {
      const cloudMaterial = new THREE.MeshStandardMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
        roughness: 1,
      });

      void loadSurfaceTexture('earth-clouds.png', 'mask')
        .then((texture) => {
          cloudMaterial.alphaMap = texture;
          cloudMaterial.needsUpdate = true;
        })
        .catch((error: unknown) => {
          console.warn(
            'Die Erd-Wolkentextur konnte nicht geladen werden.',
            error,
          );
        });

      group.add(
        new THREE.Mesh(
          new THREE.SphereGeometry(spec.radius * 1.012, 80, 64),
          cloudMaterial,
        ),
      );
    }

    if (spec.rings) {
      if (!saturnRingTexture) {
        saturnRingTexture = createSaturnRingTexture();
      }

      const isSaturn = spec.name.startsWith('Saturn');
      const innerRadius = spec.radius * (isSaturn ? 1.28 : 1.45);
      const outerRadius = spec.radius * (isSaturn ? 2.2 : 1.8);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(innerRadius, outerRadius, 160),
        new THREE.MeshStandardMaterial({
          map: saturnRingTexture,
          color: isSaturn ? '#eadbb9' : '#a9d6df',
          side: THREE.DoubleSide,
          transparent: true,
          opacity: isSaturn ? 0.78 : 0.3,
          roughness: 1,
          depthWrite: false,
        }),
      );

      ring.rotation.x = -Math.PI / 2 + (isSaturn ? 0.34 : 0.22);
      ring.rotation.z = 0.12;
      group.add(ring);
    }

    const placementProgress = getAverageAnchorProgress(spec.anchorKeys);
    group.position.copy(findSafePlanetPosition(placementProgress, spec));
    group.rotation.set(
      THREE.MathUtils.degToRad(8 + Math.random() * 18),
      Math.random() * Math.PI * 2,
      Math.random() * 0.12,
    );

    group.visible = false;
    group.userData['planetName'] = spec.name;

    scene.add(group);

    planetGroups.push({
      group,
      isSun: Boolean(spec.sun),
      name: spec.name,
      visitProgresses,
    });

    if (spec.sun) {
      const sunlight = new THREE.PointLight(0xffd596, 1050, 850, 1.7);
      group.add(sunlight);
    }
  }

  function updatePlanetVisibility(): void {
    for (const planet of planetGroups) {
      const closestDistance = Math.min(
        ...planet.visitProgresses.map((progress) =>
          Math.abs(progress - travelProgress),
        ),
      );

      /*
       * Jede Planetengruppe ist einmalig. Sie erscheint nur, wenn die Kamera
       * an einem ihrer markierten Routensegmente vorbeifliegt.
       */
      planet.group.visible = closestDistance < 0.038;
    }
  }

  /* ---------- Sternenhimmel ---------- */

  function addStarfield(): void {
    if (!scene || !routeCurve) return;

    const count = window.innerWidth < 650 ? 3800 : 7400;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let index = 0; index < count; index += 1) {
      const progress = Math.random();
      const frame = getFrame(progress);

      const point = frame.point
        .clone()
        .addScaledVector(frame.side, randomBetween(-560, 560))
        .addScaledVector(frame.up, randomBetween(-340, 340))
        .addScaledVector(frame.tangent, randomBetween(-190, 190));

      const offset = index * 3;
      positions[offset] = point.x;
      positions[offset + 1] = point.y;
      positions[offset + 2] = point.z;

      const tint = Math.random();

      if (tint > 0.88) {
        colors[offset] = 0.75;
        colors[offset + 1] = 0.83;
        colors[offset + 2] = 1;
      } else {
        colors[offset] = 0.78 + Math.random() * 0.22;
        colors[offset + 1] = 0.8 + Math.random() * 0.2;
        colors[offset + 2] = 0.86 + Math.random() * 0.14;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(colors, 3),
    );

    starPoints = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.85,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: spaceTheme === 'minimal' ? 0.58 : 0.78,
        depthWrite: false,
        toneMapped: false,
      }),
    );

    scene.add(starPoints);
  }

  /* ---------- Statische Asteroidengürtel ---------- */

  function addAsteroidBelt(
    key: string,
    count: number,
    innerRadius: number,
    outerRadius: number,
  ): void {
    if (!scene) return;

    const progress = getProgressForKey(key);
    if (progress === null) return;

    const frame = getFrame(progress);
    const adjustedCount =
      window.innerWidth < 650 ? Math.floor(count * 0.58) : count;

    const rocks = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshStandardMaterial({
        color: '#96949a',
        roughness: 1,
        metalness: 0,
      }),
      adjustedCount,
    );

    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();

    for (let index = 0; index < adjustedCount; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = randomBetween(innerRadius, outerRadius);
      const along = randomBetween(-outerRadius * 0.42, outerRadius * 0.42);

      dummy.position
        .copy(frame.point)
        .addScaledVector(frame.side, Math.cos(angle) * radius)
        .addScaledVector(frame.up, Math.sin(angle) * radius * 0.3)
        .addScaledVector(frame.tangent, along);

      dummy.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI,
      );

      const size = randomBetween(0.25, 1.05);
      dummy.scale.set(size, size * randomBetween(0.55, 1.25), size);
      dummy.updateMatrix();
      rocks.setMatrixAt(index, dummy.matrix);

      tint.setHSL(
        randomBetween(0.08, 0.12),
        randomBetween(0.03, 0.12),
        randomBetween(0.35, 0.61),
      );
      rocks.setColorAt(index, tint);
    }

    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;

    scene.add(rocks);
  }

  /* ---------- Galaxien: eindeutige Objekte, keine Doppel-Instanzen ---------- */

  function makeFallbackGalaxyTexture(): THREE.CanvasTexture {
    const galaxyCanvas = document.createElement('canvas');
    galaxyCanvas.width = 512;
    galaxyCanvas.height = 512;

    const context = galaxyCanvas.getContext('2d');

    if (!context) {
      return new THREE.CanvasTexture(galaxyCanvas);
    }

    const center = 256;
    const glow = context.createRadialGradient(
      center,
      center,
      3,
      center,
      center,
      235,
    );

    glow.addColorStop(0, 'rgba(255, 238, 211, .94)');
    glow.addColorStop(0.1, 'rgba(193, 176, 255, .66)');
    glow.addColorStop(0.38, 'rgba(115, 140, 255, .2)');
    glow.addColorStop(1, 'rgba(28, 67, 121, 0)');

    context.fillStyle = glow;
    context.fillRect(0, 0, 512, 512);

    for (let arm = 0; arm < 3; arm += 1) {
      for (let point = 0; point < 390; point += 1) {
        const along = point / 390;
        const angle = along * 7.4 + arm * (Math.PI * 2 / 3);
        const radius = 12 + along * 205;
        const spread = (Math.random() - 0.5) * (9 + along * 26);
        const x = center + Math.cos(angle) * radius + spread;
        const y = center + Math.sin(angle) * radius * 0.58 + spread * 0.55;

        context.globalAlpha = Math.random() * 0.62 * (1 - along * 0.35);
        context.fillStyle = Math.random() > 0.6 ? '#e1e5ff' : '#8edbff';
        context.beginPath();
        context.arc(x, y, Math.random() * 1.7 + 0.4, 0, Math.PI * 2);
        context.fill();
      }
    }

    context.globalAlpha = 1;

    const texture = new THREE.CanvasTexture(galaxyCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function loadGalaxyTexture(filename: string): Promise<THREE.Texture> {
    const cached = galaxyTextureCache.get(filename);
    if (cached) return cached;

    const promise = new Promise<THREE.Texture>((resolve) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';

      image.onload = () => {
        try {
          const workCanvas = document.createElement('canvas');
          workCanvas.width = image.naturalWidth || 512;
          workCanvas.height = image.naturalHeight || 512;

          const context = workCanvas.getContext('2d', {
            willReadFrequently: true,
          });

          if (!context) {
            resolve(galaxyFallbackTexture ?? makeFallbackGalaxyTexture());
            return;
          }

          context.drawImage(image, 0, 0, workCanvas.width, workCanvas.height);

          const imageData = context.getImageData(
            0,
            0,
            workCanvas.width,
            workCanvas.height,
          );

          for (let index = 0; index < imageData.data.length; index += 4) {
            const red = imageData.data[index] ?? 0;
            const green = imageData.data[index + 1] ?? 0;
            const blue = imageData.data[index + 2] ?? 0;
            const originalAlpha = (imageData.data[index + 3] ?? 255) / 255;

            const luminance =
              red * 0.2126 +
              green * 0.7152 +
              blue * 0.0722;

            imageData.data[index + 3] = Math.round(
              255 * smoothstep(5, 58, luminance) * originalAlpha,
            );
          }

          context.putImageData(imageData, 0, 0);

          const texture = new THREE.CanvasTexture(workCanvas);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.needsUpdate = true;
          resolve(texture);
        } catch (error) {
          console.warn(
            `Galaxientextur ${filename} konnte nicht vorbereitet werden.`,
            error,
          );
          resolve(galaxyFallbackTexture ?? makeFallbackGalaxyTexture());
        }
      };

      image.onerror = () => {
        console.warn(
          `Galaxientextur fehlt: public/textures/${filename}. Es wird eine Ersatzdarstellung verwendet.`,
        );
        resolve(galaxyFallbackTexture ?? makeFallbackGalaxyTexture());
      };

      image.src = `${TEXTURE_ROOT}${filename}`;
    });

    galaxyTextureCache.set(filename, promise);
    return promise;
  }

  function getAnchorVisitProgresses(key: string): number[] {
    const outboundProgress = getProgressForKey(key);
    if (outboundProgress === null) return [];

    const visits = [outboundProgress];
    const returnProgress = getReturnProgressForKey(key);

    if (returnProgress !== null) {
      visits.push(returnProgress);
    }

    return [...new Set(visits)];
  }

  function addGalaxySprite(
    key: string,
    filename: string,
    options: {
      sideOffset: number;
      upOffset: number;
      forwardOffset: number;
      width: number;
      height: number;
      tint: string;
      opacity: number;
      fadeRange?: number;
    },
  ): void {
    if (!scene) return;

    const anchorProgress = getProgressForKey(key);
    if (anchorProgress === null) return;

    const frame = getFrame(anchorProgress);
    const position = frame.point
      .clone()
      .addScaledVector(frame.side, options.sideOffset)
      .addScaledVector(frame.up, options.upOffset)
      .addScaledVector(frame.tangent, options.forwardOffset);

    const fallback =
      galaxyFallbackTexture ?? makeFallbackGalaxyTexture();
    galaxyFallbackTexture = fallback;

    const material = new THREE.SpriteMaterial({
      map: fallback,
      color: new THREE.Color(options.tint),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });

    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(options.width, options.height, 1);
    sprite.renderOrder = 2;
    material.rotation = randomBetween(-0.9, 0.9);
    scene.add(sprite);

    void loadGalaxyTexture(filename).then((texture) => {
      material.map = texture;
      material.needsUpdate = true;
    });

    const visits = getAnchorVisitProgresses(key);
    const offsetProgress = options.forwardOffset / Math.max(routeLength, 1);

    galaxySprites.push({
      material,
      visitProgresses: visits.map((visit) =>
        clamp(visit + offsetProgress, 0, 1),
      ),
      fadeRange: options.fadeRange ?? 0.1,
      maxOpacity: options.opacity,
    });
  }

  function addGalaxyCluster(
    key: string,
    mainTexture: string,
    smallCount: number,
    mainWidth: number,
    mainHeight: number,
    tint: string,
  ): void {
    const mobileFactor = window.innerWidth < 650 ? 0.58 : 1;
    const adjustedCount = Math.max(2, Math.floor(smallCount * mobileFactor));
    const tintOptions = ['#d9e8ff', '#c4caff', '#b7eaff', '#ead6ff'];

    addGalaxySprite(key, mainTexture, {
      sideOffset: randomBetween(-78, 78),
      upOffset: randomBetween(-46, 46),
      forwardOffset: 95,
      width: mainWidth,
      height: mainHeight,
      tint,
      opacity: 0.82,
      fadeRange: 0.11,
    });

    for (let index = 0; index < adjustedCount; index += 1) {
      const filename =
        Math.random() > 0.48 ? 'milky-way.png' : 'andromeda.png';

      addGalaxySprite(key, filename, {
        sideOffset: randomBetween(-220, 220),
        upOffset: randomBetween(-135, 135),
        forwardOffset: randomBetween(45, 285),
        width: randomBetween(22, 62),
        height: randomBetween(16, 45),
        tint:
          tintOptions[Math.floor(Math.random() * tintOptions.length)] ??
          '#d9e8ff',
        opacity: randomBetween(0.46, 0.7),
        fadeRange: 0.11,
      });
    }
  }

  function addGalaxyScatter(key: string, count: number): void {
    const mobileFactor = window.innerWidth < 650 ? 0.58 : 1;
    const adjustedCount = Math.max(2, Math.floor(count * mobileFactor));
    const tints = ['#c7d9ff', '#e0c9ff', '#b7efff', '#ffd8b2'];

    for (let index = 0; index < adjustedCount; index += 1) {
      const filename =
        Math.random() > 0.5 ? 'andromeda.png' : 'milky-way.png';

      addGalaxySprite(key, filename, {
        sideOffset: randomBetween(-240, 240),
        upOffset: randomBetween(-150, 150),
        forwardOffset: randomBetween(35, 300),
        width: randomBetween(22, 68),
        height: randomBetween(16, 48),
        tint: tints[Math.floor(Math.random() * tints.length)] ?? '#c7d9ff',
        opacity: randomBetween(0.44, 0.68),
        fadeRange: 0.12,
      });
    }
  }

  function addGalaxyFields(): void {
    addGalaxyCluster(
      'milky-way-edge',
      'milky-way.png',
      5,
      180,
      112,
      '#d7e8ff',
    );

    addGalaxySprite('magellanic-clouds', 'milky-way.png', {
      sideOffset: -92,
      upOffset: 18,
      forwardOffset: 100,
      width: 108,
      height: 66,
      tint: '#b9d8ff',
      opacity: 0.78,
      fadeRange: 0.11,
    });

    addGalaxySprite('magellanic-clouds', 'andromeda.png', {
      sideOffset: 82,
      upOffset: -24,
      forwardOffset: 155,
      width: 75,
      height: 48,
      tint: '#d6bfff',
      opacity: 0.73,
      fadeRange: 0.11,
    });

    addGalaxyScatter('magellanic-clouds', 5);
    addGalaxyCluster('local-group', 'milky-way.png', 7, 92, 60, '#d2e5ff');
    addGalaxyCluster('andromeda', 'andromeda.png', 8, 205, 138, '#d6c6ff');
    addGalaxyCluster('triangulum', 'milky-way.png', 6, 112, 74, '#b9d9ff');
    addGalaxyCluster('sombrero', 'andromeda.png', 5, 126, 77, '#ffdfbd');
    addGalaxyCluster('virgo-cluster', 'milky-way.png', 12, 142, 94, '#e0d5ff');
    addGalaxyCluster('coma-cluster', 'andromeda.png', 16, 120, 82, '#c5dfff');
    addGalaxyCluster('distant-field', 'milky-way.png', 22, 94, 65, '#d7d3ff');
  }

  /* ---------- Erzählung und Routenstatus ---------- */

  const routeEventDefinitions: RouteEventDefinition[] = [
    {
      key: 'earth-inbound',
      name: 'Erde',
      approach:
        'Die Erde kommt voraus ins Sichtfeld. Wir verlassen den Startorbit und nehmen Kurs Richtung Sonne.',
      passed:
        'Die Erde gleitet an uns vorbei. Vor uns liegen Venus, Merkur und die Sonne.',
      returnApproach:
        'Auf dem Vorwärtskurs zur Erde kommt unser Heimatplanet wieder in Sicht.',
      returnPassed:
        'Die Erde liegt wieder hinter uns. Der Flug geht vorwärts weiter bis zum Startorbit.',
      window: 0.006,
    },
    {
      key: 'venus-inbound',
      name: 'Venus',
      approach:
        'Die helle Wolkenwelt der Venus wächst am Horizont und rückt näher.',
      passed:
        'Die Venus zieht an uns vorbei. Der Kurs führt weiter nach innen, Richtung Merkur.',
      returnApproach:
        'Die Venus erscheint erneut voraus, während wir auf Vorwärtskurs zur Erde bleiben.',
      returnPassed:
        'Die Venus bleibt hinter uns zurück. Vor uns liegt die Erde.',
      window: 0.006,
    },
    {
      key: 'mercury-inbound',
      name: 'Merkur',
      approach:
        'Merkur nähert sich. Seine graue, von Kratern gezeichnete Oberfläche wird deutlicher.',
      passed:
        'Merkur bleibt hinter uns. Vor uns liegt der Sonnenanflug.',
      returnApproach:
        'Merkur kommt beim Vorwärtsflug zurück zur Erde wieder ins Blickfeld.',
      returnPassed:
        'Merkur entfernt sich hinter uns. Die Erde rückt näher.',
      window: 0.006,
    },
    {
      key: 'sun-approach',
      name: 'Sonne',
      approach:
        'Die Sonne wird größer und heller. Wir steuern den Wendepunkt an und halten Abstand zur Oberfläche.',
      passed:
        'Die Sonne liegt hinter uns. Wir gehen in eine weite Kurve über und nehmen wieder Kurs auf die Erde.',
      returnApproach:
        'Die Sonne kommt beim Vorwärtsflug zur Erde erneut voraus ins Blickfeld.',
      returnPassed:
        'Die Sonne bleibt hinter uns. Wir setzen den Vorwärtsflug zur Erde fort.',
      window: 0.007,
    },
    {
      key: 'sun-turn-middle',
      name: 'Sonnenwende',
      approach:
        'Wir erreichen den Wendebogen an der Sonne. Das Raumschiff dreht sich in einer weiten Kurve.',
      passed:
        'Die Wende ist abgeschlossen. Unser Bug zeigt zurück Richtung Erde; der Flug geht vorwärts weiter.',
      window: 0.006,
    },
    {
      key: 'mercury-solar-return',
      name: 'Merkur · Sonnen-Rückkurs',
      approach:
        'Merkur nähert sich auf dem Vorwärtskurs zurück zur Erde.',
      passed:
        'Merkur bleibt hinter uns. Als Nächstes kommt die Venus in Sicht.',
      returnApproach:
        'Auf dem späteren Rückflug kommt Merkur wieder voraus ins Sichtfeld.',
      returnPassed:
        'Merkur entfernt sich hinter uns. Die Erde rückt näher.',
      window: 0.006,
    },
    {
      key: 'venus-solar-return',
      name: 'Venus · Sonnen-Rückkurs',
      approach:
        'Die Venus erscheint erneut am Horizont. Wir bleiben auf Vorwärtskurs zur Erde.',
      passed:
        'Die Venus zieht hinter uns zurück. Die Erde ist die nächste Station.',
      returnApproach:
        'Die Venus kommt auf dem Vorwärtsflug wieder in Sicht.',
      returnPassed:
        'Die Venus liegt nun hinter uns. Wir fliegen weiter Richtung Erde.',
      window: 0.006,
    },
    {
      key: 'earth-solar-return',
      name: 'Erde · Rückkehr vom Sonnenflug',
      approach:
        'Die Erde wächst im Sichtfenster. Wir schließen den Bogen um die Sonne und erreichen den Erdorbit.',
      passed:
        'Der Erdorbit liegt hinter uns. Jetzt beginnt die Reise nach außen zu Mars und den äußeren Planeten.',
      returnApproach:
        'Die Erde kommt auf dem Vorwärtsflug wieder näher.',
      returnPassed:
        'Wir passieren den Erdorbit und setzen den Vorwärtsflug entlang der Route fort.',
      window: 0.007,
    },
    {
      key: 'earth-departure',
      name: 'Erdorbit · Kurs nach außen',
      approach:
        'Wir verlassen den Erdorbit. Vor uns beginnt der lange Flug durch das Sonnensystem.',
      passed:
        'Die Erde wird kleiner. Der Mars liegt voraus.',
      returnApproach:
        'Der Erdorbit kommt wieder näher; das Raumschiff bleibt auf Vorwärtskurs.',
      returnPassed:
        'Der Erdorbit liegt hinter uns. Wir fliegen weiter vorwärts zur Sonne und zurück zur Erde.',
      window: 0.006,
    },
    {
      key: 'mars',
      name: 'Mars',
      approach:
        'Der Mars nähert sich. Seine rostrote Oberfläche wird im Sichtfenster deutlicher.',
      passed:
        'Der Mars liegt hinter uns. Vor uns öffnet sich die Region des Asteroidengürtels.',
      returnApproach:
        'Der Mars kommt auf dem Vorwärtsflug Richtung Erde wieder in Sicht.',
      returnPassed:
        'Der Mars bleibt hinter uns. Wir setzen den Vorwärtskurs Richtung Erde fort.',
      window: 0.006,
    },
    {
      key: 'asteroid-belt',
      name: 'Asteroidengürtel',
      approach:
        'Wir nähern uns dem Asteroidengürtel. Einzelne Felsbrocken ziehen in sicherem Abstand vorbei.',
      passed:
        'Der Asteroidengürtel liegt hinter uns. Jupiter rückt langsam näher.',
      returnApproach:
        'Auf dem Vorwärtsflug zur Erde erreichen wir erneut die Region des Asteroidengürtels.',
      returnPassed:
        'Die Felsbrocken bleiben hinter uns. Der Vorwärtskurs führt weiter zur Erde.',
      window: 0.007,
    },
    {
      key: 'jupiter',
      name: 'Jupiter',
      approach:
        'Jupiter erscheint als gewaltige gestreifte Welt voraus. Wir nähern uns auf sicherer Bahn.',
      passed:
        'Jupiter zieht hinter uns zurück. Weiter voraus wartet Saturn mit seinen Ringen.',
      returnApproach:
        'Jupiter wird auf dem Vorwärtskurs zurück zur Sonne wieder sichtbar.',
      returnPassed:
        'Jupiter bleibt hinter uns. Wir setzen den Vorwärtsflug zur Erde fort.',
      window: 0.007,
    },
    {
      key: 'saturn',
      name: 'Saturn',
      approach:
        'Saturns Ringe treten aus der Dunkelheit hervor. Wir nähern uns auf sicherer Bahn.',
      passed:
        'Saturn und seine Ringe bleiben hinter uns. Der Kurs führt weiter zu Uranus.',
      returnApproach:
        'Saturn kommt auf dem Vorwärtsflug zurück ins Sichtfeld.',
      returnPassed:
        'Saturn liegt hinter uns. Der Vorwärtskurs führt weiter Richtung Erde.',
      window: 0.007,
    },
    {
      key: 'uranus',
      name: 'Uranus',
      approach:
        'Uranus nähert sich als blass türkisfarbene Welt am Rand des Sonnensystems.',
      passed:
        'Uranus entfernt sich hinter uns. Neptun liegt voraus.',
      returnApproach:
        'Uranus kommt auf dem Vorwärtskurs wieder in Sicht.',
      returnPassed:
        'Uranus bleibt hinter uns. Wir fliegen weiter vorwärts Richtung Erde.',
      window: 0.007,
    },
    {
      key: 'neptune',
      name: 'Neptun',
      approach:
        'Der blaue Neptun erscheint voraus. Er ist der letzte Planet dieser virtuellen Reise.',
      passed:
        'Neptun bleibt hinter uns. Vor uns liegen Kuipergürtel und Heliopause.',
      returnApproach:
        'Neptun kommt auf dem Vorwärtsflug zur Erde wieder in Sicht.',
      returnPassed:
        'Neptun liegt hinter uns. Der Vorwärtskurs führt weiter ins Sonnensystem.',
      window: 0.007,
    },
    {
      key: 'kuiper-belt',
      name: 'Kuipergürtel',
      approach:
        'Wir erreichen den Kuipergürtel. Weit verstreute Eis- und Gesteinskörper ziehen vorbei.',
      passed:
        'Der Kuipergürtel bleibt zurück. Die Grenze des Sonnenwinds rückt näher.',
      returnApproach:
        'Auf dem Vorwärtsflug zur Erde erreichen wir wieder den Kuipergürtel.',
      returnPassed:
        'Der Kuipergürtel liegt hinter uns. Wir setzen den Kurs zur Erde fort.',
      window: 0.007,
    },
    {
      key: 'heliopause',
      name: 'Heliopause',
      approach:
        'Die Heliopause kommt näher – die Grenze, an der der Einfluss des Sonnenwinds stark abnimmt.',
      passed:
        'Die Heliopause liegt hinter uns. Vor uns öffnet sich der interstellare Raum.',
      returnApproach:
        'Auf dem Vorwärtsflug zur Erde nähern wir uns erneut der Heliopause.',
      returnPassed:
        'Die Heliopause liegt hinter uns. Wir fliegen weiter vorwärts ins Sonnensystem.',
      window: 0.008,
    },
    {
      key: 'milky-way-edge',
      name: 'Milchstraße',
      approach:
        'Die Spiralarme der Milchstraße treten deutlicher hervor. Wir nähern uns dem Rand unserer Heimatgalaxie.',
      passed:
        'Die Milchstraße bleibt hinter uns. Vor uns liegt die Lokale Gruppe mit ihren Nachbargalaxien.',
      returnApproach:
        'Die Milchstraße zeichnet sich auf dem Vorwärtskurs zur Erde wieder ab.',
      returnPassed:
        'Die Milchstraße liegt hinter uns. Wir setzen den Vorwärtsflug Richtung Sonnensystem fort.',
      window: 0.01,
    },
    {
      key: 'magellanic-clouds',
      name: 'Magellansche Wolken',
      approach:
        'Wir nähern uns der Großen und der Kleinen Magellanschen Wolke – bekannten Begleitgalaxien der Milchstraße.',
      passed:
        'Die Magellanschen Wolken bleiben hinter uns. Weiter voraus liegt die Lokale Gruppe.',
      returnApproach:
        'Auf dem Vorwärtsflug zur Milchstraße kommen die Magellanschen Wolken wieder näher.',
      returnPassed:
        'Die Magellanschen Wolken liegen hinter uns. Die Milchstraße rückt näher.',
      window: 0.012,
    },
    {
      key: 'local-group',
      name: 'Lokale Gruppe',
      approach:
        'Die Lokale Gruppe kommt in den Blick. Zu ihr gehören unter anderem die Milchstraße und Andromeda.',
      passed:
        'Die Lokale Gruppe liegt hinter uns. Andromeda rückt als nächstes großes Ziel näher.',
      returnApproach:
        'Auf dem Vorwärtskurs zur Milchstraße erreichen wir wieder die Lokale Gruppe.',
      returnPassed:
        'Die Lokale Gruppe bleibt hinter uns. Wir setzen den Vorwärtsflug fort.',
      window: 0.012,
    },
    {
      key: 'andromeda',
      name: 'Andromeda · M31',
      approach:
        'Wir nähern uns der Andromedagalaxie M31, einer großen Nachbarin der Milchstraße.',
      passed:
        'Andromeda zieht hinter uns zurück. Die Dreiecksgalaxie M33 liegt weiter voraus.',
      returnApproach:
        'Andromeda erscheint auf dem Vorwärtsflug zurück zur Milchstraße erneut am Horizont.',
      returnPassed:
        'Andromeda bleibt hinter uns. Wir fliegen weiter vorwärts Richtung Milchstraße.',
      window: 0.012,
    },
    {
      key: 'triangulum',
      name: 'Dreiecksgalaxie · M33',
      approach:
        'Die Dreiecksgalaxie M33 kommt näher – ein weiteres bekanntes Mitglied der Lokalen Gruppe.',
      passed:
        'M33 liegt hinter uns. Weiter voraus erscheint die Sombrerogalaxie M104.',
      returnApproach:
        'Auf dem Vorwärtskurs zurück zur Milchstraße kommt M33 wieder in Sicht.',
      returnPassed:
        'M33 entfernt sich hinter uns. Wir setzen den Vorwärtsflug fort.',
      window: 0.012,
    },
    {
      key: 'sombrero',
      name: 'Sombrerogalaxie · M104',
      approach:
        'Die Sombrerogalaxie M104 rückt ins Blickfeld. Ihr heller Kern hebt sich von dunklen Staubbändern ab.',
      passed:
        'M104 bleibt hinter uns. Der Virgohaufen liegt weiter auf unserer erzählerischen Route.',
      returnApproach:
        'Auf dem Vorwärtsflug Richtung Milchstraße kommt M104 wieder näher.',
      returnPassed:
        'Die Sombrerogalaxie liegt hinter uns. Wir setzen den Vorwärtskurs fort.',
      window: 0.012,
    },
    {
      key: 'virgo-cluster',
      name: 'Virgohaufen · M87',
      approach:
        'Wir nähern uns dem Virgohaufen. Die riesige elliptische Galaxie M87 fällt besonders auf.',
      passed:
        'Der Virgohaufen bleibt hinter uns. Weiter draußen liegt der Coma-Galaxienhaufen.',
      returnApproach:
        'Auf dem Vorwärtsflug zur Milchstraße rückt der Virgohaufen wieder näher.',
      returnPassed:
        'M87 und der Virgohaufen liegen hinter uns. Wir setzen den Vorwärtskurs fort.',
      window: 0.013,
    },
    {
      key: 'coma-cluster',
      name: 'Coma-Galaxienhaufen',
      approach:
        'Der Coma-Galaxienhaufen zeichnet sich in der Ferne ab – eine große Ansammlung ferner Galaxien.',
      passed:
        'Der Coma-Haufen bleibt hinter uns. Vor uns liegen noch weiter entfernte Galaxienfelder.',
      returnApproach:
        'Auf dem Vorwärtsflug Richtung Milchstraße kommt der Coma-Haufen wieder in Sicht.',
      returnPassed:
        'Der Coma-Haufen liegt hinter uns. Wir setzen den Vorwärtskurs fort.',
      window: 0.013,
    },
    {
      key: 'distant-field',
      name: 'Ferne Galaxienfelder',
      approach:
        'Immer weiter draußen tauchen neue Galaxien als einzelne Lichtinseln auf. Die vertrauten Sternbilder sind längst zurückgeblieben.',
      passed:
        'Die fernsten Galaxien bleiben hinter uns. Das Raumschiff erreicht nun den Wendebogen.',
      returnApproach:
        'Auf dem Vorwärtsflug zurück in Richtung Milchstraße erscheinen ferne Galaxien erneut am Horizont.',
      returnPassed:
        'Die Galaxienfelder liegen hinter uns. Wir setzen den Vorwärtsflug fort.',
      window: 0.014,
    },
  ];

  function buildRouteEvents(): void {
    routeEvents.length = 0;

    for (const definition of routeEventDefinitions) {
      const outboundIndex =
        outboundControlIndexByKey.get(definition.key);

      if (outboundIndex === undefined) continue;

      const outboundProgress = controlProgress[outboundIndex];

      if (outboundProgress !== undefined) {
        routeEvents.push({
          name: definition.name,
          direction: 'outbound',
          progress: outboundProgress,
          approach: definition.approach,
          passed: definition.passed,
          window: definition.window ?? 0.007,
        });
      }

      const returnIndex =
        returnControlIndexByOutboundIndex.get(outboundIndex);

      if (returnIndex !== undefined) {
        const returnProgress = controlProgress[returnIndex];

        if (returnProgress !== undefined) {
          routeEvents.push({
            name: definition.name,
            direction: 'return',
            progress: returnProgress,
            approach:
              definition.returnApproach ??
              `Auf dem Vorwärtskurs zur Erde rückt ${definition.name} erneut ins Sichtfeld.`,
            passed:
              definition.returnPassed ??
              `${definition.name} liegt hinter uns. Wir fliegen weiter vorwärts Richtung Erde.`,
            window: definition.window ?? 0.007,
          });
        }
      }
    }

    routeEvents.sort((a, b) => a.progress - b.progress);
  }

  function getNearestRouteEvent(): {
    event: RouteEvent;
    approaching: boolean;
  } | null {
    const direction: RouteDirection =
      phase === 'return' ? 'return' : 'outbound';

    let bestEvent: RouteEvent | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const event of routeEvents) {
      if (event.direction !== direction) continue;

      const distance = Math.abs(travelProgress - event.progress);

      if (distance <= event.window && distance < bestDistance) {
        bestEvent = event;
        bestDistance = distance;
      }
    }

    if (!bestEvent) return null;

    return {
      event: bestEvent,
      approaching: travelProgress <= bestEvent.progress,
    };
  }

  function getPhysicalOutboundFraction(): number {
    if (phase === 'outbound') {
      return clamp(
        travelProgress / Math.max(outboundEndProgress, 0.0001),
        0,
        1,
      );
    }

    if (phase === 'turnaround') return 1;

    if (phase === 'return') {
      const returnFraction =
        (travelProgress - farTurnEndProgress) /
        Math.max(1 - farTurnEndProgress, 0.0001);

      return clamp(1 - returnFraction, 0, 1);
    }

    return 0;
  }

  function getCurrentRouteStatus(): {
    title: string;
    description: string;
  } {
    if (phase === 'turnaround') {
      return {
        title: 'Wendemanöver · Deep Space',
        description:
          'Am fernen Ziel beschreibt das Raumschiff eine weite Kurve. Der Bug dreht sich allmählich; danach geht der Flug wieder vorwärts Richtung Milchstraße.',
      };
    }

    if (phase === 'earth-pause') {
      return {
        title: 'Erde · Ankunft',
        description:
          'Wir sind am Erdorbit angekommen. Nach einer kurzen Pause beginnt die Reise erneut.',
      };
    }

    const nearbyEvent = getNearestRouteEvent();

    if (nearbyEvent) {
      const { event, approaching } = nearbyEvent;
      const prefix =
        event.direction === 'return' ? 'Rückflug · ' : '';

      return {
        title: approaching
          ? `${prefix}${event.name} · im Anflug`
          : `${prefix}${event.name} · zieht vorbei`,
        description: approaching
          ? event.approach
          : event.passed,
      };
    }

    const direction: RouteDirection =
      phase === 'return' ? 'return' : 'outbound';

    const previousEvent = [...routeEvents]
      .reverse()
      .find(
        (event) =>
          event.direction === direction &&
          event.progress < travelProgress,
      );

    const nextEvent = routeEvents.find(
      (event) =>
        event.direction === direction &&
        event.progress > travelProgress,
    );

    const physicalFraction = getPhysicalOutboundFraction();
    const heliopauseProgress = getProgressForKey('heliopause') ?? 1;
    const heliopauseFraction =
      heliopauseProgress / Math.max(outboundEndProgress, 0.0001);

    if (physicalFraction >= heliopauseFraction) {
      if (phase === 'return') {
        return {
          title: 'Rückflug · interstellarer Raum',
          description:
            'Die Galaxienfelder liegen hinter uns. Vorwärts entlang des Rückkurses nähern wir uns wieder der Milchstraße.',
        };
      }

      return {
        title: 'Jenseits des Sonnensystems',
        description:
          'Die Planeten bleiben zurück. Sterne und ferne Galaxien ziehen am Sichtfenster vorbei.',
      };
    }

    if (phase === 'return') {
      return {
        title: 'Rückflug · Vorwärtskurs',
        description:
          `${previousEvent?.name ?? 'Die letzte Station'} liegt hinter uns. ` +
          `Weiter voraus ${nextEvent ? `nähert sich ${nextEvent.name}` : 'geht es Richtung Erde'}.`,
      };
    }

    if (previousEvent && nextEvent) {
      return {
        title: 'Vorwärtsflug',
        description:
          `${previousEvent.name} liegt hinter uns. Weiter voraus nähert sich ${nextEvent.name}.`,
      };
    }

    return {
      title: 'Start im Erdorbit',
      description:
        'Die Erde liegt voraus. Wir nehmen Kurs auf die Sonne und beginnen die Reise.',
    };
  }

  function formatMissionTime(seconds: number): string {
    const wholeSeconds = Math.floor(Math.max(seconds, 0));
    const minutes = Math.floor(wholeSeconds / 60).toString().padStart(2, '0');
    const remainder = (wholeSeconds % 60).toString().padStart(2, '0');

    return `T+${minutes}:${remainder}`;
  }

  const routeStageKeys = [
    'start',
    'earth-departure',
    'jupiter',
    'heliopause',
    'milky-way-edge',
  ];

  function getRouteStageIndex(): number {
    const physicalFraction = getPhysicalOutboundFraction();
    let activeStage = 0;

    for (let index = 1; index < routeStageKeys.length; index += 1) {
      const key = routeStageKeys[index];
      if (!key) continue;

      const markerProgress =
        key === 'start' ? 0 : getProgressForKey(key);

      if (markerProgress === null || markerProgress === undefined) continue;

      const threshold =
        markerProgress / Math.max(outboundEndProgress, 0.0001);

      if (physicalFraction >= threshold) {
        activeStage = index;
      }
    }

    return activeStage;
  }

  function updateFlightPanel(): void {
    const status = getCurrentRouteStatus();
    const stateKey = `${status.title}|${status.description}`;

    if (stateKey !== lastHudState) {
      lastHudState = stateKey;

      if (routeName) routeName.textContent = status.title;
      if (routeDescription) routeDescription.textContent = status.description;
    }

    if (missionTime) {
      missionTime.textContent = formatMissionTime(elapsedSeconds);
    }

    const progressValue = Math.round(travelProgress * 100);

    if (routeProgressElement) {
      routeProgressElement.setAttribute(
        'aria-valuenow',
        String(progressValue),
      );
    }

    if (routeProgressFill) {
      routeProgressFill.style.width = `${progressValue}%`;
    }

    const activeStage = getRouteStageIndex();

    routeButtons.forEach((button) => {
      const pressed = Number(button.dataset.routeIndex) === activeStage;

      if (button.getAttribute('aria-pressed') !== String(pressed)) {
        button.setAttribute('aria-pressed', String(pressed));
      }
    });

    const heliopauseProgress = getProgressForKey('heliopause') ?? 1;
    const heliopauseFraction =
      heliopauseProgress / Math.max(outboundEndProgress, 0.0001);
    const isDeepSpace =
      getPhysicalOutboundFraction() >= heliopauseFraction;

    document.body.classList.toggle('deep-space', isDeepSpace);
    document.body.dataset.routeChapter = String(activeStage);

    const photoOpacity = isDeepSpace
      ? 0.24
      : 0.55 - getPhysicalOutboundFraction() * 0.25;

    document.documentElement.style.setProperty(
      '--photo-opacity',
      clamp(photoOpacity, 0.2, 0.55).toFixed(3),
    );
  }

  /* ---------- Kamera ---------- */

  function updateCamera(): void {
    if (!camera || !routeCurve) return;

    const progress = clamp(travelProgress, 0.0001, 0.9999);
    const frame = getFrame(progress);

    const pointerOffset = frame.side
      .clone()
      .multiplyScalar(pointerTarget.x * 0.48)
      .addScaledVector(frame.up, -pointerTarget.y * 0.28);

    camera.position.copy(frame.point).add(pointerOffset);

    const lookAhead = frame.point
      .clone()
      .addScaledVector(frame.tangent, 55)
      .add(pointerOffset);

    camera.up.set(0, 1, 0);
    camera.lookAt(lookAhead);

    let bank = 0;

    if (
      phase === 'turnaround' &&
      farTurnEndProgress > farTurnStartProgress
    ) {
      const turnProgress =
        (travelProgress - farTurnStartProgress) /
        (farTurnEndProgress - farTurnStartProgress);

      bank += Math.sin(clamp(turnProgress, 0, 1) * Math.PI) * 0.2;
    }

    camera.rotateZ(bank);
  }

  function updateGalaxyVisibility(): void {
    for (const galaxy of galaxySprites) {
      let closestDistance = Number.POSITIVE_INFINITY;

      for (const visitProgress of galaxy.visitProgresses) {
        closestDistance = Math.min(
          closestDistance,
          Math.abs(visitProgress - travelProgress),
        );
      }

      const fade =
        1 -
        smoothstep(
          galaxy.fadeRange * 0.45,
          galaxy.fadeRange,
          closestDistance,
        );

      galaxy.material.opacity = fade * galaxy.maxOpacity;
    }
  }

  function renderOnce(): void {
    if (!renderer || !scene || !camera) return;

    updateCamera();
    updatePlanetVisibility();
    updateGalaxyVisibility();
    renderer.render(scene, camera);
  }

  /* ---------- Meteore und bewegte Asteroiden ---------- */

  function spawnMeteor(): void {
    if (!scene || !camera) return;

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);

    const right = new THREE.Vector3()
      .setFromMatrixColumn(camera.matrixWorld, 0)
      .normalize();

    const up = new THREE.Vector3()
      .setFromMatrixColumn(camera.matrixWorld, 1)
      .normalize();

    const start = camera.position
      .clone()
      .addScaledVector(forward, randomBetween(42, 82))
      .addScaledVector(right, randomBetween(-42, 42))
      .addScaledVector(up, randomBetween(-24, 24));

    const end = start
      .clone()
      .addScaledVector(right, randomBetween(-12, 12))
      .addScaledVector(up, randomBetween(-10, -4));

    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const material = new THREE.LineBasicMaterial({
      color: Math.random() > 0.5 ? '#c6f2ff' : '#d6caff',
      transparent: true,
      opacity: 0.82,
    });

    const line = new THREE.Line(geometry, material);
    scene.add(line);

    meteors.push({
      line,
      velocity: right
        .multiplyScalar(randomBetween(-8, 8))
        .addScaledVector(up, randomBetween(-8, -3))
        .addScaledVector(forward, randomBetween(1, 5)),
      life: 2.5,
    });
  }

  function updateMeteors(delta: number): void {
    if (!scene) return;

    for (let index = meteors.length - 1; index >= 0; index -= 1) {
      const meteor = meteors[index];
      if (!meteor) continue;

      const positions = meteor.line.geometry.getAttribute(
        'position',
      ) as THREE.BufferAttribute;

      for (let point = 0; point < positions.count; point += 1) {
        positions.setXYZ(
          point,
          positions.getX(point) + meteor.velocity.x * delta,
          positions.getY(point) + meteor.velocity.y * delta,
          positions.getZ(point) + meteor.velocity.z * delta,
        );
      }

      positions.needsUpdate = true;
      meteor.life -= delta;
      meteor.line.material.opacity = Math.max(0, meteor.life / 2.5) * 0.82;

      if (meteor.life <= 0) {
        scene.remove(meteor.line);
        meteor.line.geometry.dispose();
        meteor.line.material.dispose();
        meteors.splice(index, 1);
      }
    }
  }

  function spawnFlyingAsteroid(): void {
    if (!scene || !camera) return;

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);

    const right = new THREE.Vector3()
      .setFromMatrixColumn(camera.matrixWorld, 0)
      .normalize();

    const up = new THREE.Vector3()
      .setFromMatrixColumn(camera.matrixWorld, 1)
      .normalize();

    const size = randomBetween(0.45, 1.4);
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(size, 1),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(
          randomBetween(0.08, 0.13),
          randomBetween(0.04, 0.13),
          randomBetween(0.38, 0.62),
        ),
        roughness: 1,
        metalness: 0,
      }),
    );

    mesh.position
      .copy(camera.position)
      .addScaledVector(forward, randomBetween(35, 75))
      .addScaledVector(right, randomBetween(-45, 45))
      .addScaledVector(up, randomBetween(-28, 28));

    mesh.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI,
    );

    scene.add(mesh);

    flyingAsteroids.push({
      mesh,
      velocity: right
        .multiplyScalar(randomBetween(-7, 7))
        .addScaledVector(up, randomBetween(-2, 2))
        .addScaledVector(forward, randomBetween(2, 7)),
      life: randomBetween(4, 7),
    });

    if (flyingAsteroids.length > 4) {
      const oldest = flyingAsteroids.shift();

      if (oldest) {
        scene.remove(oldest.mesh);
        oldest.mesh.geometry.dispose();
        oldest.mesh.material.dispose();
      }
    }
  }

  function updateFlyingAsteroids(delta: number): void {
    if (!scene) return;

    for (
      let index = flyingAsteroids.length - 1;
      index >= 0;
      index -= 1
    ) {
      const asteroid = flyingAsteroids[index];
      if (!asteroid) continue;

      asteroid.mesh.position.addScaledVector(asteroid.velocity, delta);
      asteroid.mesh.rotation.x += delta * 0.45;
      asteroid.mesh.rotation.y += delta * 0.72;
      asteroid.life -= delta;

      if (asteroid.life <= 0) {
        scene.remove(asteroid.mesh);
        asteroid.mesh.geometry.dispose();
        asteroid.mesh.material.dispose();
        flyingAsteroids.splice(index, 1);
      }
    }
  }

 

  function updateMovingObjects(delta: number): void {
    ambientSeconds += delta;

    if (phase !== 'earth-pause') {
      meteorCountdown -= delta;

      if (meteorCountdown <= 0) {
        spawnMeteor();
        meteorCountdown = randomBetween(12, 23);
      }
    }

    updateMeteors(delta);

    const physicalFraction = getPhysicalOutboundFraction();
    const asteroidProgress = getProgressForKey('asteroid-belt');
    const kuiperProgress = getProgressForKey('kuiper-belt');

    const asteroidFraction =
      asteroidProgress === null
        ? -1
        : asteroidProgress / Math.max(outboundEndProgress, 0.0001);

    const kuiperFraction =
      kuiperProgress === null
        ? -1
        : kuiperProgress / Math.max(outboundEndProgress, 0.0001);

    const nearRockyRegion =
      Math.abs(physicalFraction - asteroidFraction) < 0.045 ||
      Math.abs(physicalFraction - kuiperFraction) < 0.045;

    if (nearRockyRegion && phase !== 'earth-pause') {
      asteroidCountdown -= delta;

      if (asteroidCountdown <= 0) {
        spawnFlyingAsteroid();
        asteroidCountdown = randomBetween(4.5, 8.5);
      }
    } else {
      asteroidCountdown = Math.min(asteroidCountdown, 2);
    }

    updateFlyingAsteroids(delta);

    planetGroups.forEach(({ group, isSun }) => {
      if (!isSun) {
        group.rotation.y += delta * 0.018;
      }
    });

    if (starPoints) {
      starPoints.rotation.y = Math.sin(ambientSeconds * 0.09) * 0.0025;
    }
  }

  /* ---------- Hinflug, Wende und Rückflug ---------- */

  function moveJourney(delta: number): void {
    let remaining = Math.max(delta, 0);
    const speed = speedMultipliers[speedMode] ?? 1;

    while (remaining > 0.00001) {
      if (phase === 'outbound') {
        const rate =
          (outboundEndProgress / OUTBOUND_DURATION_SECONDS) * speed;

        if (rate <= 0) return;

        const timeToTurn = Math.max(
          0,
          (farTurnStartProgress - travelProgress) / rate,
        );
        const used = Math.min(remaining, timeToTurn);

        travelProgress += used * rate;
        elapsedSeconds += used;
        remaining -= used;

        if (travelProgress >= farTurnStartProgress - 0.000001) {
          travelProgress = farTurnStartProgress;
          phase = 'turnaround';
          lastHudState = '';
        }

        if (used === 0 && phase === 'outbound') break;
        continue;
      }

      if (phase === 'turnaround') {
        const turnDistance = farTurnEndProgress - farTurnStartProgress;
        const rate =
          (turnDistance / TURNAROUND_DURATION_SECONDS) * speed;

        if (rate <= 0) {
          phase = 'return';
          lastHudState = '';
          continue;
        }

        const timeToCompleteTurn = Math.max(
          0,
          (farTurnEndProgress - travelProgress) / rate,
        );
        const used = Math.min(remaining, timeToCompleteTurn);

        travelProgress += used * rate;
        elapsedSeconds += used;
        remaining -= used;

        if (travelProgress >= farTurnEndProgress - 0.000001) {
          travelProgress = farTurnEndProgress;
          phase = 'return';
          lastHudState = '';
        }

        if (used === 0 && phase === 'turnaround') break;
        continue;
      }

      if (phase === 'return') {
        const returnDistance = 1 - farTurnEndProgress;
        const rate =
          (returnDistance / RETURN_DURATION_SECONDS) * speed;

        if (rate <= 0) return;

        const timeToEarth = Math.max(
          0,
          (1 - travelProgress) / rate,
        );
        const used = Math.min(remaining, timeToEarth);

        travelProgress += used * rate;
        elapsedSeconds += used;
        remaining -= used;

        if (travelProgress >= 0.999999) {
          travelProgress = 1;
          phase = 'earth-pause';
          phaseTimer = EARTH_PAUSE_SECONDS;
          lastHudState = '';
        }

        if (used === 0 && phase === 'return') break;
        continue;
      }

      const used = Math.min(remaining, phaseTimer);

      phaseTimer -= used;
      remaining -= used;

      if (phaseTimer <= 0.00001) {
        phase = 'outbound';
        travelProgress = 0;
        elapsedSeconds = 0;
        phaseTimer = 0;
        meteorCountdown = 4;
        asteroidCountdown = 4;
        lastHudState = '';
      }

      if (used === 0 && phase === 'earth-pause') break;
    }
  }

  function updateScene(delta: number): void {
    moveJourney(delta);
    updateMovingObjects(delta);
    updateCamera();
    updatePlanetVisibility();
    updateGalaxyVisibility();
    updateFlightPanel();
  }

  /* ---------- Rendering ---------- */


  function startAnimation(): void {
    if (
      animationFrameId !== null ||
      isPaused ||
      document.hidden ||
      !renderer ||
      !scene ||
      !camera
    ) {
      return;
    }

    lastFrameTime = 0;

    const animate = (now: number): void => {
      animationFrameId = null;

      if (isPaused || document.hidden || !renderer || !scene || !camera) {
        return;
      }

      const delta =
        lastFrameTime === 0
          ? 0
          : Math.min((now - lastFrameTime) / 1000, 0.05);

      lastFrameTime = now;

      updateScene(delta);
      renderer.render(scene, camera);

      animationFrameId = window.requestAnimationFrame(animate);
    };

    animationFrameId = window.requestAnimationFrame(animate);
  }

  function stopAnimation(): void {
    if (animationFrameId !== null) {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    lastFrameTime = 0;
  }

  function updateMotionControl(): void {
    if (motionToggle) {
      motionToggle.setAttribute('aria-pressed', String(isPaused));
      motionToggle.setAttribute(
        'aria-label',
        isPaused ? 'Bewegung fortsetzen' : 'Bewegung pausieren',
      );
    }

    if (motionLabel) {
      motionLabel.textContent = isPaused
        ? 'Bewegung fortsetzen'
        : 'Bewegung pausieren';
    }
  }

  function setPaused(paused: boolean): void {
    isPaused = paused;
    document.body.classList.toggle('motion-paused', isPaused);
    updateMotionControl();

    if (isPaused) {
      stopAnimation();
      renderOnce();
    } else {
      startAnimation();
    }
  }

  /* ---------- Routen-Karten ---------- */

  function jumpToRouteStage(index: number): void {
    const key = routeStageKeys[index];
    if (!key) return;

    if (key === 'start') {
      travelProgress = 0;
    } else {
      const target = getProgressForKey(key);
      if (target === null) return;
      travelProgress = target;
    }

    phase = 'outbound';
    phaseTimer = 0;
    elapsedSeconds =
      (travelProgress / Math.max(outboundEndProgress, 0.0001)) *
      (OUTBOUND_DURATION_SECONDS / (speedMultipliers[speedMode] ?? 1));

    lastHudState = '';
    updateFlightPanel();
    renderOnce();

    if (!isPaused) startAnimation();
  }

  routeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.routeIndex);

      if (Number.isInteger(index)) {
        jumpToRouteStage(index);
      }
    });
  });

  /* ---------- Three.js-Szene initialisieren ---------- */

  function setupScene(): void {
    if (!canvas) return;

    try {
      buildRouteGeometry();
      buildRouteEvents();

      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      });

      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.02;

      scene = new THREE.Scene();

      camera = new THREE.PerspectiveCamera(
        64,
        window.innerWidth / Math.max(window.innerHeight, 1),
        0.1,
        12000,
      );

      scene.add(
        new THREE.HemisphereLight(0xc7ddff, 0x171a28, 0.76),
      );

      const directionalLight = new THREE.DirectionalLight(0xffe8cf, 1.25);
      directionalLight.position.set(-70, 90, -110);
      scene.add(directionalLight);

      const coolFill = new THREE.DirectionalLight(0x8db8ff, 0.42);
      coolFill.position.set(60, 35, 60);
      scene.add(coolFill);

      galaxyFallbackTexture = makeFallbackGalaxyTexture();

      addStarfield();

      planetSpecs.forEach(addPlanet);

      addAsteroidBelt('asteroid-belt', 230, 38, 105);
      addAsteroidBelt('kuiper-belt', 145, 34, 92);

      addGalaxyFields();

      updateCamera();
      updatePlanetVisibility();
      updateFlightPanel();
      renderOnce();
    } catch (error) {
      console.error('Three.js-Szene konnte nicht gestartet werden:', error);
      canvas.hidden = true;
      document.documentElement.classList.add('no-webgl');
    }
  }

  function resizeScene(): void {
    if (!renderer || !camera) return;

    camera.aspect = window.innerWidth / Math.max(window.innerHeight, 1);
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderOnce();
  }

  window.addEventListener('resize', resizeScene, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopAnimation();
    } else if (!isPaused) {
      startAnimation();
    }
  });

  /* ---------- Einstellungen ---------- */

  speedSelect?.addEventListener('change', () => {
    if (!Object.prototype.hasOwnProperty.call(speedMultipliers, speedSelect.value)) {
      return;
    }

    speedMode = speedSelect.value;
    safeWriteStorage('adel-space-speed', speedMode);
  });

  themeSelect?.addEventListener('change', () => {
    if (
      themeSelect.value !== 'cinematic' &&
      themeSelect.value !== 'minimal'
    ) {
      return;
    }

    spaceTheme = themeSelect.value;
    document.body.dataset.spaceTheme = spaceTheme;
    safeWriteStorage('adel-space-theme', spaceTheme);

    if (starPoints?.material instanceof THREE.PointsMaterial) {
      starPoints.material.opacity =
        spaceTheme === 'minimal' ? 0.58 : 0.78;
    }

    renderOnce();
  });

  motionToggle?.addEventListener('click', () => {
    motionControlUsed = true;
    setPaused(!isPaused);
  });

  reducedMotionQuery.addEventListener(
    'change',
    (event: MediaQueryListEvent) => {
      if (!motionControlUsed) {
        setPaused(event.matches);
      }
    },
  );

  /* ---------- Schwarzes-Loch-Cursor ---------- */

  function applyCursorState(): void {
    document.body.classList.toggle(
      'custom-cursor-active',
      cursorEnabled,
    );

    if (cursorToggle) {
      cursorToggle.disabled = !finePointer;
      cursorToggle.setAttribute('aria-pressed', String(cursorEnabled));
    }

    if (cursorLabel) {
      cursorLabel.textContent = finePointer
        ? cursorEnabled
          ? 'Cursor: an'
          : 'Cursor: aus'
        : 'Cursor: Maus nötig';
    }
  }

  const savedCursor = safeReadStorage('adel-space-cursor');

  if (savedCursor === 'off') {
    cursorEnabled = false;
  } else if (savedCursor === 'on' && finePointer) {
    cursorEnabled = true;
  }

  cursorToggle?.addEventListener('click', () => {
    cursorEnabled = finePointer && !cursorEnabled;
    safeWriteStorage('adel-space-cursor', cursorEnabled ? 'on' : 'off');
    applyCursorState();
  });

  document.addEventListener(
    'pointermove',
    (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;

      pointerTarget.x =
        (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2;
      pointerTarget.y =
        (event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2;

      if (!cursorEnabled || !finePointer || !cursorElement) return;

      cursorElement.style.left = `${event.clientX}px`;
      cursorElement.style.top = `${event.clientY}px`;
      cursorElement.classList.add('is-visible');
    },
    { passive: true },
  );

  document.addEventListener('pointerover', (event: PointerEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || !cursorElement) return;

    cursorElement.classList.toggle(
      'is-hovering',
      Boolean(target.closest('a, button, input, select')),
    );
  });

  window.addEventListener('blur', () => {
    cursorElement?.classList.remove('is-visible');
  });

  applyCursorState();

  /* ---------- Mobile-Navigation ---------- */

  function closeMenu(): void {
    menuToggle?.setAttribute('aria-expanded', 'false');
    menuToggle?.setAttribute('aria-label', 'Navigation öffnen');
    siteNav?.classList.remove('is-open');
  }

  menuToggle?.addEventListener('click', () => {
    const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';

    menuToggle.setAttribute('aria-expanded', String(!isOpen));
    menuToggle.setAttribute(
      'aria-label',
      isOpen ? 'Navigation öffnen' : 'Navigation schließen',
    );
    siteNav?.classList.toggle('is-open', !isOpen);
  });

  siteNav?.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', closeMenu);
  });

  /* ---------- Lokaler Bord-Navigator ---------- */

  function closeAssistant(): void {
    if (!assistantPanel || !assistantLauncher) return;

    assistantPanel.hidden = true;
    assistantLauncher.setAttribute('aria-expanded', 'false');
    assistantLauncher.focus();
  }

  function addChatMessage(text: string, author: 'bot' | 'user'): void {
    if (!assistantMessages) return;

    const message = document.createElement('p');
    message.className = `chat-message chat-message--${author}`;
    message.textContent = text;
    assistantMessages.append(message);
    assistantMessages.scrollTop = assistantMessages.scrollHeight;
  }

  function scrollToSection(id: string): void {
    document.getElementById(id)?.scrollIntoView({
      behavior: reducedMotionQuery.matches ? 'auto' : 'smooth',
      block: 'start',
    });
  }

  function getLocalAnswer(question: string): string {
    const normalized = question.toLocaleLowerCase('de-DE');

    if (/route|planet|weltraum|wo sind wir|galaxie/.test(normalized)) {
      const status = getCurrentRouteStatus();

      return `Im Flight Log steht gerade „${status.title}“. Die Strecke ist eine künstlerische Simulation, keine Live-Ortung.`;
    }

    if (
      /bachelor|barrierefreiheit|accessibility|pa11y|axe/.test(normalized)
    ) {
      scrollToSection('barrierefreiheit');

      return 'Adels Bachelorarbeit behandelt die Barrierefreiheit von Hochschulwebseiten. Er nutzt unter anderem Pa11y, axe-core, Lighthouse, WAVE und CAAT.';
    }

    if (/erfahrung|beruf|adesso|arbeit|testing/.test(normalized)) {
      scrollToSection('missionen');

      return 'Adels Schwerpunkt liegt auf manuellem und explorativem Testing, Testmanagement und Fehleranalyse – ergänzt durch Cypress-Automatisierung.';
    }

    if (/kompetenz|kenntnis|jira|cypress|werkzeug|tool/.test(normalized)) {
      scrollToSection('kompetenzen');

      return 'Im Kompetenzbereich findest du unter anderem Jira, Xray, Confluence, Cypress, Git, Pa11y, axe-core, Lighthouse, WAVE und CAAT.';
    }

    if (/kontakt|mail|email|linkedin|github/.test(normalized)) {
      scrollToSection('kontakt');
      return 'Im Kontaktbereich findest du E-Mail, LinkedIn und GitHub.';
    }

    if (/hobby|zeichnen|antiqu|geschichte/.test(normalized)) {
      scrollToSection('jenseits');

      return 'Adel interessiert sich für das Weltall, Antiquitäten und historische Themen. In seiner Freizeit zeichnet er gerne.';
    }

    return 'Ich bin ein lokal hinterlegter Seitenassistent. Frag mich nach Adels Erfahrung, Bachelorarbeit, Kompetenzen, Interessen, Kontakt oder der simulierten Route.';
  }

  function submitQuestion(question: string): void {
    const trimmed = question.trim();
    if (!trimmed) return;

    addChatMessage(trimmed, 'user');

    if (assistantInput) {
      assistantInput.value = '';
    }

    window.setTimeout(() => {
      addChatMessage(getLocalAnswer(trimmed), 'bot');
    }, 160);
  }

  assistantLauncher?.addEventListener('click', () => {
    if (!assistantPanel || !assistantLauncher) return;

    const isOpen =
      assistantLauncher.getAttribute('aria-expanded') === 'true';

    assistantPanel.hidden = isOpen;
    assistantLauncher.setAttribute('aria-expanded', String(!isOpen));

    if (!isOpen) {
      assistantInput?.focus();
    }
  });

  assistantClose?.addEventListener('click', closeAssistant);

  assistantForm?.addEventListener('submit', (event: SubmitEvent) => {
    event.preventDefault();
    submitQuestion(assistantInput?.value ?? '');
  });

  document.querySelectorAll<HTMLButtonElement>('[data-question]').forEach((button) => {
    button.addEventListener('click', () => {
      submitQuestion(button.dataset.question ?? '');
    });
  });

  document.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;

    if (assistantPanel && !assistantPanel.hidden) {
      closeAssistant();
    }

    if (menuToggle?.getAttribute('aria-expanded') === 'true') {
      closeMenu();
      menuToggle.focus();
    }
  });

  /* ---------- Reveal-Animationen und Kartenreaktionen ---------- */

  const revealElements = Array.from(
    document.querySelectorAll<HTMLElement>('[data-reveal]'),
  );

  if ('IntersectionObserver' in window && !reducedMotionQuery.matches) {
    const observer = new IntersectionObserver(
      (entries, activeObserver) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            activeObserver.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.12,
        rootMargin: '0px 0px -3% 0px',
      },
    );

    revealElements.forEach((element) => observer.observe(element));
  } else {
    revealElements.forEach((element) => {
      element.classList.add('is-visible');
    });
  }

  if (finePointer && !reducedMotionQuery.matches) {
    document.querySelectorAll<HTMLElement>('.interactive-card').forEach((card) => {
      card.addEventListener('pointermove', (event: PointerEvent) => {
        if (event.pointerType === 'touch') return;

        const bounds = card.getBoundingClientRect();
        const x =
          (event.clientX - bounds.left) / Math.max(bounds.width, 1) - 0.5;
        const y =
          (event.clientY - bounds.top) / Math.max(bounds.height, 1) - 0.5;

        card.style.setProperty('--rotate-x', `${(0.5 - y) * 2.2}deg`);
        card.style.setProperty('--rotate-y', `${x * 2.8}deg`);
      });

      card.addEventListener('pointerleave', () => {
        card.style.removeProperty('--rotate-x');
        card.style.removeProperty('--rotate-y');
      });
    });
  }

  if (currentYear) {
    currentYear.textContent = String(new Date().getFullYear());
  }

  /* ---------- Einmalige Initialisierung ---------- */

  setupScene();
  updateFlightPanel();
  updateMotionControl();

  if (isPaused) {
    renderOnce();
  } else {
    startAnimation();
  }
}