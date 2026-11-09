import * as THREE from 'three';
import { getProceduralRoadInfluence, drawRoadOnRadar, getRandomSeed } from './Road.js';
export { getRandomSeed };

// -------------------------------------------------------------
// 1. Deterministic Math & Seeded Perlin Noise (Identical in JS & GLSL)
// -------------------------------------------------------------

function fract(x) {
    return x - Math.floor(x);
}

// Dave Hoskins Hash without Sine with Seed Offset (CPU implementation)
function hash2(px, py, seed = 1337.0) {
    const sx = seed * 0.13371;
    const sy = seed * 0.37139;
    let p3x = fract((px + sx) * 0.1031);
    let p3y = fract((py + sy) * 0.1031);
    let p3z = fract((px + sx) * 0.1031);
    const d = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
    p3x += d;
    p3y += d;
    p3z += d;
    const angle = fract((p3x + p3y) * p3z) * 6.283185307179586;
    return [Math.cos(angle), Math.sin(angle)];
}

// 2D Gradient Perlin Noise with Quintic Hermite C2 Interpolation & Seed
export function perlin2D(x, y, seed = 1337.0) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;

    // Quintic curve: 6t^5 - 15t^4 + 10t^3
    const ux = fx * fx * fx * (fx * (fx * 6.0 - 15.0) + 10.0);
    const uy = fy * fy * fy * (fy * (fy * 6.0 - 15.0) + 10.0);

    const [g00x, g00y] = hash2(ix, iy, seed);
    const [g10x, g10y] = hash2(ix + 1, iy, seed);
    const [g01x, g01y] = hash2(ix, iy + 1, seed);
    const [g11x, g11y] = hash2(ix + 1, iy + 1, seed);

    const d00 = g00x * fx + g00y * fy;
    const d10 = g10x * (fx - 1.0) + g10y * fy;
    const d01 = g01x * fx + g01y * (fy - 1.0);
    const d11 = g11x * (fx - 1.0) + g11y * (fy - 1.0);

    const x0 = d00 + ux * (d10 - d00);
    const x1 = d01 + ux * (d11 - d01);
    return x0 + uy * (x1 - x0);
}

// Fractal Brownian Motion (FBM) with normalized amplitude & Seed
export function fbm2D(x, y, octaves = 3, lacunarity = 2.0, persistence = 0.35, seed = 1337.0) {
    let sum = 0.0;
    let amp = 1.0;
    let freq = 1.0;
    let maxAmp = 0.0;

    for (let i = 0; i < 5; i++) {
        if (i >= octaves) break;
        sum += perlin2D(x * freq, y * freq, seed + i * 17.13) * amp;
        maxAmp += amp;
        freq *= lacunarity;
        amp *= persistence;
    }

    return maxAmp > 0.0 ? sum / maxAmp : 0.0;
}

// Full mathematical terrain elevation function (matching shader 100% anywhere in infinite space)
export function getTerrainElevation(x, z, params = DEFAULT_GROUND_CONFIG) {
    const elevation = params.elevation ?? 25.0;
    const frequency = params.frequency ?? 0.025;
    const octaves = params.octaves ?? 4;
    const persistence = params.persistence ?? 0.70;
    const lacunarity = params.lacunarity ?? 1.0;
    const seed = params.seed ?? 1170.0;

    const noiseVal = fbm2D(x * frequency, z * frequency, octaves, lacunarity, persistence, seed);
    let h = noiseVal * elevation;

    // Carve road path into mountains
    const roadCarve = params.roadCarve ?? true;
    if (roadCarve) {
        const roadWidth = params.roadWidth ?? 32.0;
        const shoulderWidth = params.shoulderWidth ?? 20.0;
        const roadElevationScale = params.roadElevationScale ?? 1.0;

        const road = getProceduralRoadInfluence(x, z, roadWidth, shoulderWidth, roadElevationScale, seed);
        if (road.factor > 0.0) {
            // Smooth Hermite blend between road elevation and mountain elevation
            h = (1.0 - road.factor) * h + road.factor * road.roadHeight;
        }
    } else {
        // Fallback spawn flat plateau if road carving is disabled
        const spawnFlatRadius = params.spawnFlatRadius ?? 0.0;
        if (spawnFlatRadius > 0.0) {
            const dist = Math.hypot(x, z);
            const rInner = Math.max(0.0, spawnFlatRadius - 4.0);
            const rOuter = spawnFlatRadius + 8.0;
            const t = Math.min(Math.max((dist - rInner) / (rOuter - rInner), 0.0), 1.0);
            const blend = t * t * (3.0 - 2.0 * t);
            h *= blend;
        }
    }

    return h;
}

// Analytical terrain normal via central differences
export function getTerrainNormal(x, z, params = DEFAULT_GROUND_CONFIG, eps = 0.35) {
    const hL = getTerrainElevation(x - eps, z, params);
    const hR = getTerrainElevation(x + eps, z, params);
    const hD = getTerrainElevation(x, z - eps, params);
    const hU = getTerrainElevation(x, z + eps, params);

    const normal = new THREE.Vector3(hL - hR, 2.0 * eps, hD - hU);
    return normal.normalize();
}

// -------------------------------------------------------------
// 2. Default Configuration for Infinite Procedural Generation
// -------------------------------------------------------------

export const DEFAULT_GROUND_CONFIG = {
    seed: getRandomSeed(),   // Random world seed generated on every startup/reload
    chunkSize: 40,           // Dimension of each chunk in meters (40x40m)
    segmentsPerChunk: 24,    // Geometry grid resolution per chunk
    renderDistance: 4,       // Visual chunk radius around car (4 chunks = ~160m radius)
    physicsRadius: 2,        // Physics collision chunk radius (2 chunks = 5x5 grid = ~200m around car)
    elevation: 25.00,        // Height amplitude of rolling hills
    frequency: 0.025,        // Noise wavelength scale
    octaves: 4,              // Octave layering (1 to 5)
    persistence: 0.70,       // Roughness
    lacunarity: 1.00,        // Frequency multiplier
    spawnFlatRadius: 0.0,    // Level ground plateau (now provided smoothly by the road bed)
    roadCarve: true,         // Carve road path into mountains
    roadWidth: 32.0,         // Width of flat road surface (meters)
    shoulderWidth: 20.0,     // Mountain bank blend width (meters)
    roadElevationScale: 1.0, // Scale road uphill/downhill heights
    wireframeColor: '#788187', // Electric blue wireframe
    wireframe: true,         // Wireframe mode always active
    fogColor: '#181a1f',     // Distance fog color matching scene background
    fogNear: 45.0,           // Distance fog start in meters
    fogFar: 150.0,           // Distance fog fully opaque in meters
};

// -------------------------------------------------------------
// 3. Robust GLSL Shaders (Vertex + Fragment with Seed Support)
// -------------------------------------------------------------

const vertexShader = /* glsl */ `
precision highp float;

attribute float aRoadFactor;

varying vec3 vWorldPos;
varying vec3 vNormalVec;
varying float vElevation;
varying float vSlope;
varying vec2 vUvCoord;
varying float vRoadFactor;

void main() {
    vUvCoord = uv;
    vRoadFactor = aRoadFactor;

    // Model space vertex: X, Y, Z come directly from the CPU geometry attributes
    // Y is the exact Perlin elevation matching Rapier trimesh collider 100.000%
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vElevation = worldPos.y;

    // Normal from geometry attributes (smooth vertex normal)
    vec3 norm = normalize(normalMatrix * normal);
    vNormalVec = norm;
    vSlope = 1.0 - norm.y; // 0.0 = flat ground, ~1.0 = vertical cliff

    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;

uniform vec3 uWireframeColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;

varying vec3 vWorldPos;
varying float vElevation;
varying float vRoadFactor;

void main() {
    // Hide mountain wireframe under the road wireframe corridor
    if (vRoadFactor > 0.02) {
        discard;
    }

    // Subtle elevation brightness accent (higher ridges glow slightly more vivid electric cyan)
    float heightSheen = clamp((vElevation + 2.0) * 0.02, 0.0, 0.4);
    vec3 baseColor = clamp(uWireframeColor + vec3(heightSheen * 0.1, heightSheen * 0.35, heightSheen * 0.5), 0.0, 1.0);

    // Distance fog blend matching scene horizon
    float dist = length(cameraPosition - vWorldPos);
    float fogFactor = clamp((dist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
    vec3 finalColor = mix(baseColor, uFogColor, fogFactor);

    gl_FragColor = vec4(finalColor, 1.0);
}
`;

// -------------------------------------------------------------
// 4. Terrain Chunk Class (Pooled, Lightweight)
// -------------------------------------------------------------

class TerrainChunk {
    constructor(size, segments, material) {
        this.size = size;
        this.segments = segments;
        this.cx = 0;
        this.cz = 0;
        this.key = '';
        this.hasPhysics = false;
        this.collider = null;

        // PlaneGeometry rotated so X is width, Z is depth, Y is up (elevation)
        this.geometry = new THREE.PlaneGeometry(size, size, segments, segments);
        this.geometry.rotateX(-Math.PI / 2);

        // aRoadFactor per-vertex attribute: 1.0 when under road wireframe corridor, 0.0 on mountain
        const vertCount = (segments + 1) * (segments + 1);
        const roadFactors = new Float32Array(vertCount);
        this.geometry.setAttribute('aRoadFactor', new THREE.BufferAttribute(roadFactors, 1));

        this.mesh = new THREE.Mesh(this.geometry, material);
        this.mesh.frustumCulled = false; // Vertex shader handles displacement
        this.mesh.receiveShadow = true;
        this.mesh.visible = false;
    }

    // Set chunk world position
    setChunkCoords(cx, cz) {
        this.cx = cx;
        this.cz = cz;
        this.key = `${cx},${cz}`;
        this.mesh.position.set(cx * this.size, 0, cz * this.size);
    }

    // Populate CPU vertices for Rapier 3D Trimesh collision & road wireframe mask
    syncHeights(params) {
        const positions = this.geometry.attributes.position;
        const roadFactors = this.geometry.attributes.aRoadFactor;
        const originX = this.cx * this.size;
        const originZ = this.cz * this.size;

        const roadCarve = params.roadCarve ?? true;
        const showRoadMesh = params.showRoadMesh ?? true;
        const shouldHideUnderRoad = roadCarve && showRoadMesh;
        const roadWidth = params.roadWidth ?? 32.0;
        const shoulderWidth = params.shoulderWidth ?? 20.0;
        const roadElevationScale = params.roadElevationScale ?? 1.0;
        const seed = params.seed ?? 1170.0;
        const halfW = roadWidth * 0.5;

        for (let i = 0; i < positions.count; i++) {
            const lx = positions.getX(i);
            const lz = positions.getZ(i);
            const wx = originX + lx;
            const wz = originZ + lz;
            const h = getTerrainElevation(wx, wz, params);
            positions.setY(i, h);

            let rf = 0.0;
            if (shouldHideUnderRoad) {
                const road = getProceduralRoadInfluence(wx, wz, roadWidth, shoulderWidth, roadElevationScale, seed);
                if (road.distance < halfW) {
                    // Inside the road corridor: ramp from 0 at edge to 1.0 deeper inside
                    rf = Math.min(1.0, (halfW - road.distance) / 1.0);
                }
            }
            if (roadFactors) {
                roadFactors.setX(i, rf);
            }
        }

        positions.needsUpdate = true;
        if (roadFactors) {
            roadFactors.needsUpdate = true;
        }
        this.geometry.computeVertexNormals();
        this.geometry.computeBoundingBox();
        this.geometry.computeBoundingSphere();
    }

    dispose() {
        if (this.geometry) {
            this.geometry.dispose();
        }
    }
}

// -------------------------------------------------------------
// 5. Infinite Terrain Manager (Ground)
// -------------------------------------------------------------

export class Ground {
    constructor(scene, options = {}) {
        this.scene = scene;
        this.params = { ...DEFAULT_GROUND_CONFIG, ...options };

        this.world = null;
        this.RAPIER = null;
        this.physicsBody = null; // Single fixed rigid body hosting chunk colliders
        this.physicsRebuildTimeout = null;

        // Chunk Management Maps & Pools
        this.activeChunks = new Map(); // key -> TerrainChunk
        this.chunkPool = [];          // TerrainChunk[]
        this.physicsChunks = new Set(); // Set of keys with active Rapier colliders
        this.lastCarChunkX = null;
        this.lastCarChunkZ = null;

        this.initSharedMaterial();
    }

    initSharedMaterial() {
        this.material = new THREE.ShaderMaterial({
            wireframe: Boolean(this.params.wireframe),
            side: THREE.DoubleSide,
            depthWrite: true,
            depthTest: true,
            uniforms: {
                uWireframeColor: { value: new THREE.Color(this.params.wireframeColor || '#00a2ff') },
                uFogColor: { value: new THREE.Color(this.params.fogColor) },
                uFogNear: { value: this.params.fogNear },
                uFogFar: { value: this.params.fogFar },
                uTime: { value: 0.0 },
            },
            vertexShader,
            fragmentShader
        });
    }

    // Acquire a chunk from pool or instantiate new one
    acquireChunk(cx, cz) {
        let chunk;
        if (this.chunkPool.length > 0) {
            chunk = this.chunkPool.pop();
        } else {
            chunk = new TerrainChunk(this.params.chunkSize, this.params.segmentsPerChunk, this.material);
            this.scene.add(chunk.mesh);
        }

        chunk.setChunkCoords(cx, cz);
        chunk.syncHeights(this.params);
        chunk.mesh.visible = true;
        return chunk;
    }

    // Release chunk back to pool and unregister physics
    recycleChunk(chunk) {
        if (chunk.hasPhysics && chunk.collider && this.world) {
            try {
                this.world.removeCollider(chunk.collider, false);
            } catch {
                // ignore already removed
            }
            chunk.collider = null;
            chunk.hasPhysics = false;
        }

        chunk.mesh.visible = false;
        this.physicsChunks.delete(chunk.key);
        this.chunkPool.push(chunk);
    }

    // Initialize Rapier Physics
    createPhysics(world, RAPIER) {
        this.world = world;
        this.RAPIER = RAPIER;

        // Fixed rigid body at (0, 0, 0) hosting all active chunk colliders
        const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
        this.physicsBody = world.createRigidBody(bodyDesc);

        // Update chunks around origin immediately
        this.updateChunks(0, 0, true);
    }

    // Attach Rapier Trimesh collider to a chunk
    attachChunkPhysics(chunk) {
        if (!this.world || !this.physicsBody || !this.RAPIER) return;
        if (chunk.hasPhysics && chunk.collider) return;

        // Compute CPU heights for this chunk
        chunk.syncHeights(this.params);

        const vertices = Float32Array.from(chunk.geometry.attributes.position.array);
        const indices = Uint32Array.from(chunk.geometry.index.array);

        // FIX_INTERNAL_EDGES (144) to eliminate ghost bumps at triangle junctions
        const trimeshFlags = this.RAPIER.TriMeshFlags?.FIX_INTERNAL_EDGES ?? 144;
        const colliderDesc = this.RAPIER.ColliderDesc.trimesh(vertices, indices, trimeshFlags)
            .setTranslation(chunk.cx * this.params.chunkSize, 0, chunk.cz * this.params.chunkSize)
            .setRestitution(0.0)
            .setRestitutionCombineRule(this.RAPIER.CoefficientCombineRule.Min)
            .setFriction(0.85);

        chunk.collider = this.world.createCollider(colliderDesc, this.physicsBody);
        chunk.hasPhysics = true;
        this.physicsChunks.add(chunk.key);
    }

    // Detach Rapier Trimesh collider from a chunk
    detachChunkPhysics(chunk) {
        if (!this.world || !chunk.hasPhysics || !chunk.collider) return;

        try {
            this.world.removeCollider(chunk.collider, false);
        } catch {
            // ignore
        }
        chunk.collider = null;
        chunk.hasPhysics = false;
        this.physicsChunks.delete(chunk.key);
    }

    // Update active chunk grid around car position
    updateChunks(carX = 0, carZ = 0, force = false) {
        const chunkSize = this.params.chunkSize;
        const currentCx = Math.floor((carX + chunkSize / 2) / chunkSize);
        const currentCz = Math.floor((carZ + chunkSize / 2) / chunkSize);

        if (!force && currentCx === this.lastCarChunkX && currentCz === this.lastCarChunkZ) {
            return;
        }

        this.lastCarChunkX = currentCx;
        this.lastCarChunkZ = currentCz;

        const renderDist = this.params.renderDistance;
        const physicsRadius = this.params.physicsRadius;
        const visibleKeys = new Set();
        const physicsKeys = new Set();

        // 1. Determine which chunks should be visible and which should have physics
        const maxDistSq = (renderDist + 0.45) * (renderDist + 0.45);
        for (let dx = -renderDist; dx <= renderDist; dx++) {
            for (let dz = -renderDist; dz <= renderDist; dz++) {
                if (dx * dx + dz * dz <= maxDistSq) {
                    const cx = currentCx + dx;
                    const cz = currentCz + dz;
                    const key = `${cx},${cz}`;
                    visibleKeys.add(key);

                    // Physics vicinity: immediate neighborhood (e.g. 3x3 grid)
                    if (Math.abs(dx) <= physicsRadius && Math.abs(dz) <= physicsRadius) {
                        physicsKeys.add(key);
                    }
                }
            }
        }

        // 2. Recycle chunks that moved out of visible range
        for (const [key, chunk] of this.activeChunks.entries()) {
            if (!visibleKeys.has(key)) {
                this.recycleChunk(chunk);
                this.activeChunks.delete(key);
            }
        }

        // 3. Spawn or keep chunks in visible range
        for (const key of visibleKeys) {
            let chunk = this.activeChunks.get(key);
            if (!chunk) {
                const [cxStr, czStr] = key.split(',');
                const cx = parseInt(cxStr, 10);
                const cz = parseInt(czStr, 10);
                chunk = this.acquireChunk(cx, cz);
                this.activeChunks.set(key, chunk);
            }

            // Sync physics status
            if (physicsKeys.has(key)) {
                if (!chunk.hasPhysics) {
                    this.attachChunkPhysics(chunk);
                }
            } else {
                if (chunk.hasPhysics) {
                    this.detachChunkPhysics(chunk);
                }
            }
        }
    }

    // Rebuild all physics colliders (called on noise param / seed changes)
    rebuildPhysics() {
        for (const chunk of this.activeChunks.values()) {
            chunk.syncHeights(this.params);
            if (chunk.hasPhysics) {
                this.detachChunkPhysics(chunk);
                this.attachChunkPhysics(chunk);
            }
        }
    }

    // Compatibility alias
    syncGeometryHeights() {
        this.rebuildPhysics();
    }

    buildCollider() {
        this.rebuildPhysics();
    }

    // Query elevation at any world coordinate in infinite space
    getHeightAt(x, z) {
        return getTerrainElevation(x, z, this.params);
    }

    // Query normal at any world coordinate in infinite space
    getNormalAt(x, z) {
        return getTerrainNormal(x, z, this.params);
    }

    // Frame update for animation loop
    update(carPosOrDelta, deltaOrLight, sunPosOrAmbient, maybeSunColor, maybeAmbientColor) {
        let delta = 0.016;
        let carX = 0;
        let carZ = 0;
        let sunPosition = null;
        let sunColor = null;
        let ambientColor = null;

        // Support both update(carPos, delta, ...) and legacy update(delta, ...)
        if (carPosOrDelta && typeof carPosOrDelta.x === 'number' && typeof carPosOrDelta.z === 'number') {
            carX = carPosOrDelta.x;
            carZ = carPosOrDelta.z;
            delta = typeof deltaOrLight === 'number' ? deltaOrLight : 0.016;
            sunPosition = sunPosOrAmbient;
            sunColor = maybeSunColor;
            ambientColor = maybeAmbientColor;
        } else if (typeof carPosOrDelta === 'number') {
            delta = carPosOrDelta;
            sunPosition = deltaOrLight;
            sunColor = sunPosOrAmbient;
            ambientColor = maybeSunColor;
        }

        if (this.material && this.material.uniforms) {
            if (this.material.uniforms.uTime) {
                this.material.uniforms.uTime.value += delta;
            }

            if (sunPosition && this.material.uniforms.uLightDir) {
                this.material.uniforms.uLightDir.value.copy(sunPosition).normalize();
            }
            if (sunColor && this.material.uniforms.uLightColor) {
                this.material.uniforms.uLightColor.value.copy(sunColor);
            }
            if (ambientColor && this.material.uniforms.uAmbientColor) {
                this.material.uniforms.uAmbientColor.value.copy(ambientColor);
            }
        }

        // Dynamically stream chunks in the car's vicinity
        this.updateChunks(carX, carZ);
    }

    // Handle updates from Leva controls in real time
    updateParams(newParams, carBody = null) {
        let noiseNeedsRebuild = false;

        const noiseKeys = ['seed', 'elevation', 'frequency', 'octaves', 'persistence', 'lacunarity', 'spawnFlatRadius', 'roadCarve', 'roadWidth', 'shoulderWidth', 'roadElevationScale'];
        for (const key of noiseKeys) {
            if (newParams[key] !== undefined && Math.abs(newParams[key] - this.params[key]) > 0.0001) {
                noiseNeedsRebuild = true;
                break;
            }
        }

        if (newParams.showRoadMesh !== undefined && newParams.showRoadMesh !== this.params.showRoadMesh) {
            noiseNeedsRebuild = true;
        }

        // Apply new values to config
        this.params = { ...this.params, ...newParams };

        // 1. Instant GPU Shader Uniform updates (silky 60fps responsive)
        if (this.material && this.material.uniforms) {
            if (newParams.wireframeColor !== undefined) {
                this.material.uniforms.uWireframeColor.value.set(this.params.wireframeColor);
            }
            if (newParams.wireframe !== undefined) {
                this.material.wireframe = Boolean(this.params.wireframe);
            }
        }

        // Update active chunk range if renderDistance changed
        if (newParams.renderDistance !== undefined || newParams.physicsRadius !== undefined) {
            this.updateChunks(this.lastCarChunkX * this.params.chunkSize, this.lastCarChunkZ * this.params.chunkSize, true);
        }

        // 2. Debounced physics collider sync to maintain smooth framerate while dragging sliders
        if (noiseNeedsRebuild) {
            if (this.physicsRebuildTimeout) {
                clearTimeout(this.physicsRebuildTimeout);
            }

            this.physicsRebuildTimeout = setTimeout(() => {
                this.rebuildPhysics();

                // If car is currently clipping underneath new terrain, nudge it upward safely
                if (carBody) {
                    const t = carBody.translation();
                    const surfaceY = this.getHeightAt(t.x, t.z) + 0.45;
                    if (t.y < surfaceY) {
                        carBody.setTranslation({ x: t.x, y: surfaceY + 0.2, z: t.z }, true);
                    }
                }
            }, 60);
        }
    }

    dispose() {
        if (this.physicsRebuildTimeout) {
            clearTimeout(this.physicsRebuildTimeout);
        }

        // Clean up all active chunks
        for (const chunk of this.activeChunks.values()) {
            this.recycleChunk(chunk);
            chunk.dispose();
            if (chunk.mesh) {
                this.scene.remove(chunk.mesh);
            }
        }
        this.activeChunks.clear();

        // Clean up pool
        for (const chunk of this.chunkPool) {
            chunk.dispose();
            if (chunk.mesh) {
                this.scene.remove(chunk.mesh);
            }
        }
        this.chunkPool = [];

        // Remove physics body
        if (this.world && this.physicsBody) {
            try {
                this.world.removeRigidBody(this.physicsBody);
            } catch {
                // ignore
            }
            this.physicsBody = null;
        }

        if (this.material) {
            this.material.dispose();
        }
    }
}

// -------------------------------------------------------------
// 6. Seeded Perlin Noise Radar / Mini-Map Canvas Renderer
// -------------------------------------------------------------

/**
 * Draws a 2D topographical mini-map from seeded Perlin noise centered around the vehicle.
 */
export function drawPerlinNoiseRadar(canvas, carX, carZ, carHeading, params = DEFAULT_GROUND_CONFIG, range = 180) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const halfW = width / 2;
    const halfH = height / 2;
    const scale = width / (range * 2);

    // Fast low-res image buffer for topographical terrain contour
    const imgSize = 48;
    const imgData = ctx.createImageData(imgSize, imgSize);
    const data = imgData.data;

    const stepWorld = (range * 2) / imgSize;
    const startX = carX - range;
    const startZ = carZ - range;

    const elevAmp = params.elevation || 14.0;

    let ptr = 0;
    for (let py = 0; py < imgSize; py++) {
        const wz = startZ + py * stepWorld;
        for (let px = 0; px < imgSize; px++) {
            const wx = startX + px * stepWorld;
            const h = getTerrainElevation(wx, wz, params);
            const normH = Math.max(0, Math.min(1, (h + 2.0) / (elevAmp * 1.2 + 2.0)));

            // Color coding: pure black and white monochrome grayscale topographical radar
            const gray = Math.floor(12 + normH * 75);

            data[ptr++] = gray;
            data[ptr++] = gray;
            data[ptr++] = gray;
            data[ptr++] = 255; // Alpha
        }
    }

    // 1. Draw smooth topographical map
    ctx.clearRect(0, 0, width, height);

    // Draw temporary bitmap scaled up smoothly with image smoothing
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = imgSize;
    tempCanvas.height = imgSize;
    tempCanvas.getContext('2d').putImageData(imgData, 0, 0);

    ctx.save();
    // Clip circular radar
    ctx.beginPath();
    ctx.arc(halfW, halfH, halfW - 2, 0, Math.PI * 2);
    ctx.clip();

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tempCanvas, 0, 0, width, height);

    // 2. Draw Chunk Grid Lines
    const chunkSize = params.chunkSize || 40;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 1;

    const minChunkX = Math.floor(startX / chunkSize) * chunkSize;
    const maxChunkX = Math.ceil((startX + range * 2) / chunkSize) * chunkSize;
    for (let wx = minChunkX; wx <= maxChunkX; wx += chunkSize) {
        const sx = (wx - carX) * scale + halfW;
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, height);
        ctx.stroke();
    }

    const minChunkZ = Math.floor(startZ / chunkSize) * chunkSize;
    const maxChunkZ = Math.ceil((startZ + range * 2) / chunkSize) * chunkSize;
    for (let wz = minChunkZ; wz <= maxChunkZ; wz += chunkSize) {
        const sy = (wz - carZ) * scale + halfH;
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(width, sy);
        ctx.stroke();
    }

    // 3. Draw Radar Concentric Range Rings (50m, 100m)
    [50, 100, 150].forEach(rDist => {
        const radPix = rDist * scale;
        if (radPix < halfW - 4) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
            ctx.beginPath();
            ctx.arc(halfW, halfH, radPix, 0, Math.PI * 2);
            ctx.stroke();
        }
    });

    // Crosshairs
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.beginPath();
    ctx.moveTo(halfW, halfH - 8);
    ctx.lineTo(halfW, halfH + 8);
    ctx.moveTo(halfW - 8, halfH);
    ctx.lineTo(halfW + 8, halfH);
    ctx.stroke();

    // 3b. Draw Curved Mountain Road Path onto Topographical Radar
    if (params.roadCarve !== false) {
        drawRoadOnRadar(ctx, carX, carZ, carHeading, params.seed ?? 1170.0, range, width, height);
    }

    ctx.restore();

    // 4. Draw Radar Bezel Ring (Pure White Monochrome)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(halfW, halfH, halfW - 2, 0, Math.PI * 2);
    ctx.stroke();

    // 5. Draw Car Arrow Indicator in Center (Minimal smaller size pure white tracking)
    ctx.save();
    ctx.translate(halfW, halfH);
    // Heading in Three.js: car forward is along +X, lateral is +Z
    // In 2D map: X is right, Z is down (y)
    ctx.rotate(carHeading);

    // Glowing dot & arrow
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 4;
    ctx.fillStyle = '#ffffff';

    ctx.beginPath();
    ctx.moveTo(0, -6.5);     // Compact arrow head pointing forward
    ctx.lineTo(3.8, 4.5);
    ctx.lineTo(0, 2.2);
    ctx.lineTo(-3.8, 4.5);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}
