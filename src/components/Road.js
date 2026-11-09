import * as THREE from 'three';

/**
 * Returns a random integer seed between 1000 and 99999.
 * Runs fresh on every page load/reload in the browser.
 */
export function getRandomSeed() {
    return Math.floor(Math.random() * 90000) + 1000;
}

// -------------------------------------------------------------
// 1. Deterministic Math & Procedural 1D Gradient Noise
// -------------------------------------------------------------

function fract(x) {
    return x - Math.floor(x);
}

// Dave Hoskins 1D Hash
function hash1(p, seed = 1337.0) {
    let p3 = fract((p + seed * 0.13371) * 0.1031);
    p3 += p3 * (p3 + 33.33);
    return fract(p3 * 43758.5453) * 2.0 - 1.0; // [-1.0, 1.0]
}

// 1D Gradient Noise with Quintic Hermite C2 Interpolation and Analytical Derivative
function gradNoise1D(x, seed = 1337.0) {
    const i = Math.floor(x);
    const f = x - i;

    // Quintic Hermite curve: u(f) = 6f^5 - 15f^4 + 10f^3
    const u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    // Derivative: u'(f) = 30f^4 - 60f^3 + 30f^2 = 30f^2(1 - f)^2
    const du = 30.0 * f * f * (f * (f - 2.0) + 1.0);

    const g0 = hash1(i, seed);
    const g1 = hash1(i + 1, seed);

    const d0 = g0 * f;
    const d1 = g1 * (f - 1.0);

    const val = d0 + u * (d1 - d0);
    const deriv = g0 + u * (g1 - g0) + du * (d1 - d0);

    return { val, deriv };
}

// -------------------------------------------------------------
// 2. Infinite Procedural Road Centerline & Elevation Formulas
// -------------------------------------------------------------

/**
 * Returns the lateral road displacement Z and derivative dZ/dX at any coordinate X in infinite space.
 * Features large sweeping mountain bends, winding S-curves, and a smooth straight section at (0, 0).
 */
export function getProceduralRoadCurve(x, seed = 1170.0) {
    const n1 = gradNoise1D(x / 280.0, seed + 10.0);
    const n2 = gradNoise1D(x / 130.0, seed + 20.0);
    const n3 = gradNoise1D(x / 65.0, seed + 30.0);

    let z = n1.val * 240.0 + n2.val * 90.0 + n3.val * 25.0;
    let dz = (n1.deriv * 240.0) / 280.0 + (n2.deriv * 90.0) / 130.0 + (n3.deriv * 25.0) / 65.0;

    // Smooth level straight section around spawn point (|x| < 40m)
    const ax = Math.abs(x);
    if (ax < 40.0) {
        z = 0.0;
        dz = 0.0;
    } else if (ax < 90.0) {
        const f = (ax - 40.0) / 50.0;
        const u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
        const du = ((30.0 * f * f * (f * (f - 2.0) + 1.0)) / 50.0) * (x < 0 ? -1.0 : 1.0);
        dz = z * du + dz * u;
        z = z * u;
    }

    return { z, dz };
}

/**
 * Returns the road vertical elevation Y at coordinate X in infinite space.
 * Features uphill climbs onto mountain ridges (+25m to +30m) and downhill descents into valleys (-10m to +5m).
 */
export function getProceduralRoadElevation(x, seed = 1170.0, elevationScale = 1.0) {
    const e1 = gradNoise1D(x / 320.0, seed + 50.0).val * 75.0;
    const e2 = gradNoise1D(x / 140.0, seed + 60.0).val * 35.0;

    let y = (e1 + e2) * elevationScale;

    // Smooth level blend near spawn point (at x = 0, y = 0.000m)
    const ax = Math.abs(x);
    if (ax < 40.0) {
        y = 0.0;
    } else if (ax < 90.0) {
        const f = (ax - 40.0) / 50.0;
        const u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
        y *= u;
    }

    return y;
}

/**
 * High-speed O(1) query returning road influence, distance, road height, and blend factor for ANY (x, z).
 * Solves closest point on the procedural road curve using 3 Newton-Raphson iterations. Takes ~0.5 microseconds.
 */
export function getProceduralRoadInfluence(x, z, roadWidth = 32.0, shoulderWidth = 20.0, elevationScale = 1.0, seed = 1170.0) {
    const coarseZ = getProceduralRoadCurve(x, seed).z;
    const coarseDistZ = Math.abs(z - coarseZ);
    const maxInfluenceRadius = roadWidth * 0.5 + shoulderWidth;

    // Fast early-out for points far outside the road corridor in Z
    if (coarseDistZ > maxInfluenceRadius + 45.0) {
        return { inCorridor: false, factor: 0.0, distance: coarseDistZ, roadHeight: 0.0 };
    }

    // Refine closest t along curve using Newton-Raphson iterations
    let t = x;
    for (let iter = 0; iter < 3; iter++) {
        const rc = getProceduralRoadCurve(t, seed);
        const F = (t - x) + (rc.z - z) * rc.dz;
        const FPrime = 1.0 + rc.dz * rc.dz;
        const delta = F / FPrime;
        t -= delta;
        if (Math.abs(delta) < 0.005) break;
    }

    const rc = getProceduralRoadCurve(t, seed);
    const dist = Math.hypot(t - x, rc.z - z);

    if (dist >= maxInfluenceRadius) {
        return { inCorridor: false, factor: 0.0, distance: dist, roadHeight: 0.0 };
    }

    const halfW = roadWidth * 0.5;
    let factor = 1.0;
    if (dist > halfW) {
        const u = (dist - halfW) / Math.max(shoulderWidth, 0.01);
        const cu = Math.min(Math.max(u, 0.0), 1.0);
        factor = 1.0 - (cu * cu * (3.0 - 2.0 * cu));
    }

    const roadHeight = getProceduralRoadElevation(t, seed, elevationScale);

    return {
        inCorridor: true,
        factor,
        distance: dist,
        roadHeight,
        t,
        roadZ: rc.z,
        tangentX: 1.0,
        tangentZ: rc.dz
    };
}

// -------------------------------------------------------------
// 3. Default Configuration for Wide Infinite Mountain Wireframe Road
// -------------------------------------------------------------

export const DEFAULT_ROAD_CONFIG = {
    enabled: true,                 // Road system active
    seed: getRandomSeed(),         // Random seed on every startup
    roadWidth: 32.0,               // Wide highway (32 meters)
    shoulderWidth: 20.0,           // Wide mountain bank transition (20 meters)
    elevationScale: 1.0,           // Multiplier for uphill and downhill amplitudes
    carveStrength: 1.0,            // 1.0 = fully carved mountain pass
    showRoadMesh: true,            // Render 3D road wireframe ribbon
    roadWireframeColor: '#00a2ff', // Electric blue road wireframe
    roadBedColor: '#181a1f',       // Dark underlay bed matching scene background
};

// -------------------------------------------------------------
// 4. Infinite Streaming Road Wireframe Manager Class
// -------------------------------------------------------------

export class Road {
    constructor(scene, options = {}) {
        this.scene = scene;
        this.config = { ...DEFAULT_ROAD_CONFIG, ...options };

        // Streaming road ribbon dimensions
        this.segmentCount = 240;      // 240 segments along driving corridor
        this.segmentLength = 2.2;     // 2.2m spacing = ~528m continuous road buffer around car
        this.crossDivisions = 14;     // 14 quads across 32m width (~2.3m quad width)
        this.lastCarX = 0;
        this.lastUpdatedCarX = -99999;

        this.mesh = null;
        this.bedMesh = null;
        this.geometry = null;
        this.material = null;
        this.bedMaterial = null;

        this.init();
    }

    init() {
        // Solid backing material matching background color to block anything underneath
        this.bedMaterial = new THREE.MeshBasicMaterial({
            color: new THREE.Color(this.config.roadBedColor || '#181a1f'),
            side: THREE.DoubleSide,
            depthWrite: true,
            fog: true,
            polygonOffset: true,
            polygonOffsetFactor: 1.0,
            polygonOffsetUnits: 1.0
        });

        // Pure wireframe material: no custom shaders, no surface color fills
        this.material = new THREE.MeshBasicMaterial({
            color: new THREE.Color(this.config.roadWireframeColor || '#00a2ff'),
            wireframe: true,
            fog: true,
            side: THREE.DoubleSide
        });

        this.createStreamingGeometry();
    }

    createStreamingGeometry() {
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh = null;
        }
        if (this.bedMesh) {
            this.scene.remove(this.bedMesh);
            this.bedMesh = null;
        }
        if (this.geometry) {
            this.geometry.dispose();
            this.geometry = null;
        }

        if (!this.config.showRoadMesh) return;

        const totalPoints = this.segmentCount + 1;
        const numCross = this.crossDivisions + 1;
        const vertexCount = totalPoints * numCross;

        const positions = new Float32Array(vertexCount * 3);
        const indexCount = this.segmentCount * this.crossDivisions * 6;
        const indices = new Uint32Array(indexCount);

        let idx = 0;
        for (let i = 0; i < this.segmentCount; i++) {
            const row1 = i * numCross;
            const row2 = (i + 1) * numCross;
            for (let j = 0; j < this.crossDivisions; j++) {
                const a = row1 + j;
                const b = row2 + j;
                const c = row2 + j + 1;
                const d = row1 + j + 1;

                indices[idx++] = a;
                indices[idx++] = b;
                indices[idx++] = d;

                indices[idx++] = b;
                indices[idx++] = c;
                indices[idx++] = d;
            }
        }

        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));

        // 1. Solid underbody bed mesh (blocks any underlaying mountain wireframe)
        this.bedMesh = new THREE.Mesh(this.geometry, this.bedMaterial);
        this.bedMesh.receiveShadow = false;
        this.bedMesh.castShadow = false;
        this.bedMesh.frustumCulled = false;
        this.scene.add(this.bedMesh);

        // 2. Wireframe ribbon on top
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.receiveShadow = false;
        this.mesh.castShadow = false;
        this.mesh.frustumCulled = false;
        this.scene.add(this.mesh);

        this.updateStreamingMesh(0, true);
    }

    /**
     * Updates vertex positions of the streaming road wireframe grid centered around the vehicle.
     * Takes ~0.15ms and updates only when car moves >= 1.5m.
     */
    updateStreamingMesh(carX = 0, force = false) {
        if (!this.geometry || !this.mesh || !this.config.showRoadMesh) return;

        if (!force && Math.abs(carX - this.lastUpdatedCarX) < 1.5) {
            return;
        }

        this.lastUpdatedCarX = carX;

        const halfSpan = (this.segmentCount * this.segmentLength) * 0.5;
        const startX = Math.floor((carX - halfSpan) / this.segmentLength) * this.segmentLength;

        const positions = this.geometry.attributes.position.array;
        const numCross = this.crossDivisions + 1;

        const halfW = this.config.roadWidth * 0.5;
        const roadElevationOffset = 0.04; // Slightly above terrain to sit cleanly without clipping

        const seed = this.config.seed ?? 1170.0;
        const elevScale = this.config.elevationScale ?? 1.0;

        let vIdx = 0;

        for (let i = 0; i <= this.segmentCount; i++) {
            const x = startX + i * this.segmentLength;
            const rc = getProceduralRoadCurve(x, seed);
            const z = rc.z;
            const dz = rc.dz;

            // Normalize tangent vector: (1, 0, dz)
            const invLen = 1.0 / Math.hypot(1.0, dz);
            const tx = invLen;
            const tz = dz * invLen;

            // Lateral perpendicular vector: (-tz, 0, tx)
            const latX = -tz;
            const latZ = tx;

            const baseY = getProceduralRoadElevation(x, seed, elevScale) + roadElevationOffset;

            for (let j = 0; j < numCross; j++) {
                const frac = j / this.crossDivisions; // 0.0 to 1.0
                const offset = -halfW + frac * this.config.roadWidth;

                positions[vIdx++] = x + latX * offset;
                positions[vIdx++] = baseY;
                positions[vIdx++] = z + latZ * offset;
            }
        }

        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.computeBoundingSphere();
    }

    update(carPos) {
        if (!carPos) return;
        const carX = carPos.x ?? 0;
        this.updateStreamingMesh(carX);
    }

    updateConfig(newConfig) {
        let needsMeshRebuild = false;
        if (
            (newConfig.roadWidth !== undefined && newConfig.roadWidth !== this.config.roadWidth) ||
            (newConfig.showRoadMesh !== undefined && newConfig.showRoadMesh !== this.config.showRoadMesh) ||
            (newConfig.seed !== undefined && newConfig.seed !== this.config.seed) ||
            (newConfig.elevationScale !== undefined && newConfig.elevationScale !== this.config.elevationScale)
        ) {
            needsMeshRebuild = true;
        }

        this.config = { ...this.config, ...newConfig };

        if (this.material && newConfig.roadWireframeColor !== undefined) {
            this.material.color.set(this.config.roadWireframeColor);
        }

        if (needsMeshRebuild) {
            this.createStreamingGeometry();
        } else {
            this.updateStreamingMesh(this.lastUpdatedCarX, true);
        }
    }

    dispose() {
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh = null;
        }
        if (this.bedMesh) {
            this.scene.remove(this.bedMesh);
            this.bedMesh = null;
        }
        if (this.geometry) {
            this.geometry.dispose();
            this.geometry = null;
        }
        if (this.material) {
            this.material.dispose();
            this.material = null;
        }
        if (this.bedMaterial) {
            this.bedMaterial.dispose();
            this.bedMaterial = null;
        }
    }
}

// -------------------------------------------------------------
// 5. Draw Infinite Procedural Road on Topographical Radar
// -------------------------------------------------------------

export function drawRoadOnRadar(ctx, carX, carZ, carHeading, seed = 1170.0, range = 180, width = 160, height = 160) {
    if (!ctx) return;
    const halfW = width / 2;
    const halfH = height / 2;
    const scale = width / (range * 2);

    ctx.save();

    // Clip to circular radar
    ctx.beginPath();
    ctx.arc(halfW, halfH, halfW - 2, 0, Math.PI * 2);
    ctx.clip();

    // 1. Draw road corridor guide casing
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.lineWidth = 9.0;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    const step = 5.0; // 5-meter increments across radar range
    const startX = carX - range - 20.0;
    const endX = carX + range + 20.0;
    let started = false;

    for (let x = startX; x <= endX; x += step) {
        const rc = getProceduralRoadCurve(x, seed);
        const sx = (x - carX) * scale + halfW;
        const sy = (rc.z - carZ) * scale + halfH;

        if (!started) {
            ctx.moveTo(sx, sy);
            started = true;
        } else {
            ctx.lineTo(sx, sy);
        }
    }
    ctx.stroke();

    // 2. Draw glowing crisp white road path (Monochrome Radar)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2.0;
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 4;

    ctx.beginPath();
    started = false;
    for (let x = startX; x <= endX; x += step) {
        const rc = getProceduralRoadCurve(x, seed);
        const sx = (x - carX) * scale + halfW;
        const sy = (rc.z - carZ) * scale + halfH;

        if (!started) {
            ctx.moveTo(sx, sy);
            started = true;
        } else {
            ctx.lineTo(sx, sy);
        }
    }
    ctx.stroke();

    ctx.restore();
}

// -------------------------------------------------------------
// 5. Goal Target Projection & LiDAR Raycasts for Autonomous Driver
// -------------------------------------------------------------

/**
 * Projects an arbitrary 2D target (rawX, rawZ) to the nearest valid point
 * on the 3D road surface using Newton-Raphson curve projection and lateral border clamping.
 */
export function projectToNearestRoadPoint(rawX, rawZ, seed = 1170.0, roadHalfWidth = 16.0) {
    let t = rawX;
    for (let iter = 0; iter < 3; iter++) {
        const rc = getProceduralRoadCurve(t, seed);
        const F = (t - rawX) + (rc.z - rawZ) * rc.dz;
        const FPrime = 1.0 + rc.dz * rc.dz;
        const delta = F / FPrime;
        t -= delta;
        if (Math.abs(delta) < 0.005) break;
    }

    const road = getProceduralRoadCurve(t, seed);
    const length = Math.hypot(1.0, road.dz);
    const normX = -road.dz / length;
    const normZ = 1.0 / length;

    const dispX = rawX - t;
    const dispZ = rawZ - road.z;
    const lateralOffset = dispX * normX + dispZ * normZ;

    let targetX = rawX;
    let targetZ = rawZ;

    if (Math.abs(lateralOffset) > roadHalfWidth) {
        const clampedOffset = Math.sign(lateralOffset) * roadHalfWidth;
        targetX = t + clampedOffset * normX;
        targetZ = road.z + clampedOffset * normZ;
    }

    const targetY = getProceduralRoadElevation(targetX, seed);
    return { x: targetX, y: targetY, z: targetZ };
}

/**
 * Samples a random target ahead along the road corridor with lateral offset.
 */
export function sampleForwardRoadTarget(carX, seed = 1170.0, roadHalfWidth = 16.0, minDist = 50.0, maxDist = 130.0) {
    const dist = minDist + Math.random() * (maxDist - minDist);
    const targetX = carX + dist;
    const road = getProceduralRoadCurve(targetX, seed);
    // Sample within comfortable drivable corridor (+-8.5m) so car can physically touch it directly
    const lateralJitter = (Math.random() * 2.0 - 1.0) * 8.5;
    const rawZ = road.z + lateralJitter;
    return projectToNearestRoadPoint(targetX, rawZ, seed, roadHalfWidth * 0.75);
}

/**
 * Fast raycast from (posX, posZ) along heading to find distance to tarmac boundary (|z - roadZ| > 16m).
 */
export function computeRayDistanceToRoadEdge(posX, posZ, rayHeading, seed, roadHalfWidth = 16.0, maxDist = 60.0) {
    const cosH = Math.cos(rayHeading);
    const sinH = Math.sin(rayHeading);
    const steps = 30;
    const stepSize = maxDist / steps;

    for (let i = 1; i <= steps; i++) {
        const d = i * stepSize;
        const sx = posX + cosH * d;
        const sz = posZ + sinH * d;
        const road = getProceduralRoadCurve(sx, seed);
        if (Math.abs(sz - road.z) > roadHalfWidth) {
            return d;
        }
    }
    return maxDist;
}

