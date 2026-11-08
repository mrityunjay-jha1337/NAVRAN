import * as THREE from 'three';

// -------------------------------------------------------------
// 1. Deterministic Math & Perlin Noise (Identical in JS & GLSL)
// -------------------------------------------------------------

function fract(x) {
    return x - Math.floor(x);
}

// Dave Hoskins Hash without Sine (CPU implementation)
function hash2(px, py) {
    let p3x = fract(px * 0.1031);
    let p3y = fract(py * 0.1031);
    let p3z = fract(px * 0.1031);
    const d = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
    p3x += d;
    p3y += d;
    p3z += d;
    const angle = fract((p3x + p3y) * p3z) * 6.283185307179586;
    return [Math.cos(angle), Math.sin(angle)];
}

// 2D Gradient Perlin Noise with Quintic Hermite C2 Interpolation
export function perlin2D(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;

    // Quintic curve: 6t^5 - 15t^4 + 10t^3
    const ux = fx * fx * fx * (fx * (fx * 6.0 - 15.0) + 10.0);
    const uy = fy * fy * fy * (fy * (fy * 6.0 - 15.0) + 10.0);

    const [g00x, g00y] = hash2(ix, iy);
    const [g10x, g10y] = hash2(ix + 1, iy);
    const [g01x, g01y] = hash2(ix, iy + 1);
    const [g11x, g11y] = hash2(ix + 1, iy + 1);

    const d00 = g00x * fx + g00y * fy;
    const d10 = g10x * (fx - 1.0) + g10y * fy;
    const d01 = g01x * fx + g01y * (fy - 1.0);
    const d11 = g11x * (fx - 1.0) + g11y * (fy - 1.0);

    const x0 = d00 + ux * (d10 - d00);
    const x1 = d01 + ux * (d11 - d01);
    return x0 + uy * (x1 - x0);
}

// Fractal Brownian Motion (FBM) with normalized amplitude
export function fbm2D(x, y, octaves = 3, lacunarity = 2.0, persistence = 0.35) {
    let sum = 0.0;
    let amp = 1.0;
    let freq = 1.0;
    let maxAmp = 0.0;

    for (let i = 0; i < 5; i++) {
        if (i >= octaves) break;
        sum += perlin2D(x * freq, y * freq) * amp;
        maxAmp += amp;
        freq *= lacunarity;
        amp *= persistence;
    }

    return maxAmp > 0.0 ? sum / maxAmp : 0.0;
}

// Full mathematical terrain elevation function (matching shader 100%)
export function getTerrainElevation(x, z, params = DEFAULT_GROUND_CONFIG) {
    const elevation = params.elevation ?? 3.8;
    const frequency = params.frequency ?? 0.014;
    const octaves = params.octaves ?? 3;
    const persistence = params.persistence ?? 0.35;
    const lacunarity = params.lacunarity ?? 2.0;
    const spawnFlatRadius = params.spawnFlatRadius ?? 12.0;

    const noiseVal = fbm2D(x * frequency, z * frequency, octaves, lacunarity, persistence);
    let h = noiseVal * elevation;

    // Smooth level plateau around origin (0, 0) for safe car spawning
    if (spawnFlatRadius > 0.0) {
        const dist = Math.hypot(x, z);
        const rInner = Math.max(0.0, spawnFlatRadius - 4.0);
        const rOuter = spawnFlatRadius + 8.0;
        const t = Math.min(Math.max((dist - rInner) / (rOuter - rInner), 0.0), 1.0);
        const blend = t * t * (3.0 - 2.0 * t);
        h *= blend;
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
// 2. Default Configuration
// -------------------------------------------------------------

export const DEFAULT_GROUND_CONFIG = {
    elevation: 14.00,         // Height amplitude of rolling hills (smooth gentle slopes)
    frequency: 0.012,       // Noise wavelength scale (smooth large curves)
    octaves: 3,             // Octave layering (1 to 5)
    persistence: 0.35,      // Natural roughness (prevents acute 60° crease jumps)
    lacunarity: 2.00,        // Frequency multiplier per octave
    spawnFlatRadius: 25.0,  // Level ground radius at (0, 0)
    grassColor: '#9da8ce',  // Lush grass color
    dirtColor: '#241b12',   // Valley earth color
    rockColor: '#52565e',   // Steep slope cliff rock color
    wireframe: false,       // Wireframe debug toggle
    size: 250,              // World terrain dimension in meters (250x250m)
    segments: 160,          // Mesh grid resolution for smooth cross-section transitions
};

// -------------------------------------------------------------
// 3. Robust, Self-Contained GLSL Shaders (Vertex + Fragment)
// -------------------------------------------------------------

const vertexShader = /* glsl */ `
precision highp float;

uniform float uElevation;
uniform float uFrequency;
uniform int uOctaves;
uniform float uPersistence;
uniform float uLacunarity;
uniform float uSpawnFlatRadius;

varying vec3 vWorldPos;
varying vec3 vNormalVec;
varying float vElevation;
varying float vSlope;
varying vec2 vUvCoord;

// Dave Hoskins Hash without Sine (Deterministic GLSL hash)
vec2 hash2(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    float angle = fract((p3.x + p3.y) * p3.z) * 6.283185307179586;
    return vec2(cos(angle), sin(angle));
}

float perlin2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);

    // Quintic Hermite curve: 6t^5 - 15t^4 + 10t^3
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

    vec2 g00 = hash2(i);
    vec2 g10 = hash2(i + vec2(1.0, 0.0));
    vec2 g01 = hash2(i + vec2(0.0, 1.0));
    vec2 g11 = hash2(i + vec2(1.0, 1.0));

    float d00 = dot(g00, f);
    float d10 = dot(g10, f - vec2(1.0, 0.0));
    float d01 = dot(g01, f - vec2(0.0, 1.0));
    float d11 = dot(g11, f - vec2(1.0, 1.0));

    float x0 = mix(d00, d10, u.x);
    float x1 = mix(d01, d11, u.x);
    return mix(x0, x1, u.y);
}

float fbm2D(vec2 p, int octaves, float lacunarity, float persistence) {
    float sum = 0.0;
    float amp = 1.0;
    float freq = 1.0;
    float maxAmp = 0.0;

    for (int i = 0; i < 5; i++) {
        if (i >= octaves) break;
        sum += perlin2D(p * freq) * amp;
        maxAmp += amp;
        freq *= lacunarity;
        amp *= persistence;
    }

    return maxAmp > 0.0 ? sum / maxAmp : 0.0;
}

float getTerrainHeight(vec2 xz, float elevation, float frequency, int octaves, float persistence, float lacunarity, float spawnFlatRadius) {
    float noiseVal = fbm2D(xz * frequency, octaves, lacunarity, persistence);
    float h = noiseVal * elevation;

    if (spawnFlatRadius > 0.0) {
        float dist = length(xz);
        float rInner = max(0.0, spawnFlatRadius - 4.0);
        float rOuter = spawnFlatRadius + 8.0;
        float t = clamp((dist - rInner) / (rOuter - rInner), 0.0, 1.0);
        float blend = t * t * (3.0 - 2.0 * t);
        h *= blend;
    }

    return h;
}

void main() {
    vUvCoord = uv;

    // Model space vertex: X and Z span the plane, Y is elevation
    vec4 worldPos = modelMatrix * vec4(position.x, 0.0, position.z, 1.0);

    // Compute exact Perlin noise height displacement
    float height = getTerrainHeight(worldPos.xz, uElevation, uFrequency, uOctaves, uPersistence, uLacunarity, uSpawnFlatRadius);
    worldPos.y = height;
    vWorldPos = worldPos.xyz;
    vElevation = height;

    // Analytical normal via central differences on the Perlin function
    float eps = 0.35;
    float hL = getTerrainHeight(worldPos.xz - vec2(eps, 0.0), uElevation, uFrequency, uOctaves, uPersistence, uLacunarity, uSpawnFlatRadius);
    float hR = getTerrainHeight(worldPos.xz + vec2(eps, 0.0), uElevation, uFrequency, uOctaves, uPersistence, uLacunarity, uSpawnFlatRadius);
    float hD = getTerrainHeight(worldPos.xz - vec2(0.0, eps), uElevation, uFrequency, uOctaves, uPersistence, uLacunarity, uSpawnFlatRadius);
    float hU = getTerrainHeight(worldPos.xz + vec2(0.0, eps), uElevation, uFrequency, uOctaves, uPersistence, uLacunarity, uSpawnFlatRadius);

    vec3 normal = normalize(vec3(hL - hR, 2.0 * eps, hD - hU));
    vNormalVec = normal;
    vSlope = 1.0 - normal.y; // 0.0 = flat ground, ~1.0 = vertical cliff

    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;

uniform vec3 uGrassColor;
uniform vec3 uDirtColor;
uniform vec3 uRockColor;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbientColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uTime;

varying vec3 vWorldPos;
varying vec3 vNormalVec;
varying float vElevation;
varying float vSlope;
varying vec2 vUvCoord;

// Fast procedural noise for organic soil / rock grain detail
float hash1(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float simpleNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash1(i + vec2(0.0, 0.0)), hash1(i + vec2(1.0, 0.0)), u.x),
        mix(hash1(i + vec2(0.0, 1.0)), hash1(i + vec2(1.0, 1.0)), u.x),
        u.y
    );
}

void main() {
    vec3 normal = normalize(vNormalVec);

    // Natural surface micro-variation
    float detailNoise = simpleNoise(vWorldPos.xz * 0.75) * 0.16 - 0.08;
    float fineNoise = simpleNoise(vWorldPos.xz * 3.2) * 0.06 - 0.03;
    float microVariation = detailNoise + fineNoise;

    // Biome blending:
    // 1. Low valley dirt transition
    float valleyFactor = smoothstep(-2.0, 0.8, vElevation);
    vec3 lowGroundColor = mix(uDirtColor, uGrassColor, valleyFactor);

    // 2. Slope steepness transition (lush flat grass vs steep cliff rock)
    float slopeFactor = smoothstep(0.18, 0.44, vSlope);
    vec3 baseTerrainColor = mix(lowGroundColor, uRockColor, slopeFactor);

    // Apply micro-texture variation
    vec3 albedo = clamp(baseTerrainColor + vec3(microVariation), 0.0, 1.0);

    // Sunlight direction and diffuse shading with soft Half-Lambert wrap
    vec3 lightDir = normalize(uLightDir);
    float NdotL = max(dot(normal, lightDir), 0.0);
    float halfLambert = pow(NdotL * 0.5 + 0.5, 1.8);

    // Subtle specular sheen on slopes
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    vec3 halfVec = normalize(lightDir + viewDir);
    float spec = pow(max(dot(normal, halfVec), 0.0), 28.0) * 0.12;

    // Composite Lighting
    vec3 directLight = uLightColor * halfLambert;
    vec3 ambientLight = uAmbientColor * 0.55;
    vec3 litColor = albedo * (directLight + ambientLight) + vec3(spec);

    // Distance fog blend matching scene background
    float dist = length(cameraPosition - vWorldPos);
    float fogFactor = clamp((dist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
    vec3 finalColor = mix(litColor, uFogColor, fogFactor);

    gl_FragColor = vec4(finalColor, 1.0);
}
`;

// -------------------------------------------------------------
// 4. Ground Class Managing Visuals & Rapier Physics
// -------------------------------------------------------------

export class Ground {
    constructor(scene, options = {}) {
        this.scene = scene;
        this.params = { ...DEFAULT_GROUND_CONFIG, ...options };

        this.world = null;
        this.RAPIER = null;
        this.physicsBody = null;
        this.collider = null;
        this.physicsRebuildTimeout = null;

        this.initVisualMesh();
    }

    initVisualMesh() {
        const size = this.params.size;
        const segments = this.params.segments;

        // Plane rotated so X is width, Z is depth, Y is up (elevation)
        this.geometry = new THREE.PlaneGeometry(size, size, segments, segments);
        this.geometry.rotateX(-Math.PI / 2);

        // Prepopulate CPU vertex positions using exact Perlin elevation
        this.syncGeometryHeights();

        // 100% Reliable Custom ShaderMaterial
        this.material = new THREE.ShaderMaterial({
            wireframe: Boolean(this.params.wireframe),
            side: THREE.DoubleSide,
            depthWrite: true,
            depthTest: true,
            uniforms: {
                uElevation: { value: this.params.elevation },
                uFrequency: { value: this.params.frequency },
                uOctaves: { value: Math.round(this.params.octaves) },
                uPersistence: { value: this.params.persistence },
                uLacunarity: { value: this.params.lacunarity },
                uSpawnFlatRadius: { value: this.params.spawnFlatRadius },
                uGrassColor: { value: new THREE.Color(this.params.grassColor) },
                uDirtColor: { value: new THREE.Color(this.params.dirtColor) },
                uRockColor: { value: new THREE.Color(this.params.rockColor) },
                uLightDir: { value: new THREE.Vector3(25, 40, 20).normalize() },
                uLightColor: { value: new THREE.Color(0xffffff) },
                uAmbientColor: { value: new THREE.Color(0xffffff) },
                uFogColor: { value: new THREE.Color(0x181a1f) },
                uFogNear: { value: 90.0 },
                uFogFar: { value: 190.0 },
                uTime: { value: 0.0 },
            },
            vertexShader,
            fragmentShader
        });

        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.frustumCulled = false; // Never clip terrain
        this.mesh.receiveShadow = true;
        this.scene.add(this.mesh);
    }

    // Set CPU buffer coordinates for accurate bounding boxes & Rapier Trimesh collider
    syncGeometryHeights() {
        const positions = this.geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const z = positions.getZ(i);
            const h = getTerrainElevation(x, z, this.params);
            positions.setY(i, h);
        }
        positions.needsUpdate = true;
        this.geometry.computeVertexNormals();
        this.geometry.computeBoundingBox();
        this.geometry.computeBoundingSphere();
    }

    // Create Rapier static body and trimesh collider
    createPhysics(world, RAPIER) {
        this.world = world;
        this.RAPIER = RAPIER;

        const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
        this.physicsBody = world.createRigidBody(bodyDesc);

        this.buildCollider();
    }

    // Build or rebuild Rapier Trimesh collider from current CPU vertices
    buildCollider() {
        if (!this.world || !this.physicsBody || !this.RAPIER) return;

        // Remove previous collider if present
        if (this.collider) {
            this.world.removeCollider(this.collider, false);
            this.collider = null;
        }

        const vertices = Float32Array.from(this.geometry.attributes.position.array);
        const indices = Uint32Array.from(this.geometry.index.array);

        // Enable FIX_INTERNAL_EDGES (flag 144) to eliminate ghost bumps & jitter at triangle cross-sections
        const trimeshFlags = this.RAPIER.TriMeshFlags?.FIX_INTERNAL_EDGES ?? 144;
        const colliderDesc = this.RAPIER.ColliderDesc.trimesh(vertices, indices, trimeshFlags)
            .setRestitution(0.0)
            .setRestitutionCombineRule(this.RAPIER.CoefficientCombineRule.Min)
            .setFriction(0.85);

        this.collider = this.world.createCollider(colliderDesc, this.physicsBody);
    }

    // Handle updates from Leva controls in real time
    updateParams(newParams, carBody = null) {
        let geometryNeedsUpdate = false;
        let resolutionNeedsRebuild = false;

        if (newParams.segments !== undefined && Math.round(newParams.segments) !== this.params.segments) {
            resolutionNeedsRebuild = true;
            geometryNeedsUpdate = true;
        }

        const keysToCheck = ['elevation', 'frequency', 'octaves', 'persistence', 'lacunarity', 'spawnFlatRadius'];
        for (const key of keysToCheck) {
            if (newParams[key] !== undefined && Math.abs(newParams[key] - this.params[key]) > 0.0001) {
                geometryNeedsUpdate = true;
                break;
            }
        }

        // Apply new values to config
        this.params = { ...this.params, ...newParams };
        if (newParams.segments !== undefined) {
            this.params.segments = Math.round(newParams.segments);
        }

        if (resolutionNeedsRebuild) {
            if (this.geometry) {
                this.geometry.dispose();
            }
            this.geometry = new THREE.PlaneGeometry(
                this.params.size,
                this.params.size,
                this.params.segments,
                this.params.segments
            );
            this.geometry.rotateX(-Math.PI / 2);
            if (this.mesh) {
                this.mesh.geometry = this.geometry;
            }
        }

        // 1. Instant GPU Shader Uniform updates (60fps responsive)
        if (this.material && this.material.uniforms) {
            if (newParams.elevation !== undefined) this.material.uniforms.uElevation.value = this.params.elevation;
            if (newParams.frequency !== undefined) this.material.uniforms.uFrequency.value = this.params.frequency;
            if (newParams.octaves !== undefined) this.material.uniforms.uOctaves.value = Math.round(this.params.octaves);
            if (newParams.persistence !== undefined) this.material.uniforms.uPersistence.value = this.params.persistence;
            if (newParams.lacunarity !== undefined) this.material.uniforms.uLacunarity.value = this.params.lacunarity;
            if (newParams.spawnFlatRadius !== undefined) this.material.uniforms.uSpawnFlatRadius.value = this.params.spawnFlatRadius;

            if (newParams.grassColor !== undefined) this.material.uniforms.uGrassColor.value.set(this.params.grassColor);
            if (newParams.dirtColor !== undefined) this.material.uniforms.uDirtColor.value.set(this.params.dirtColor);
            if (newParams.rockColor !== undefined) this.material.uniforms.uRockColor.value.set(this.params.rockColor);

            if (newParams.wireframe !== undefined) {
                this.material.wireframe = Boolean(this.params.wireframe);
            }
        }

        // 2. Debounced physics collider sync to maintain silky framerate while dragging sliders
        if (geometryNeedsUpdate) {
            if (this.physicsRebuildTimeout) {
                clearTimeout(this.physicsRebuildTimeout);
            }

            this.physicsRebuildTimeout = setTimeout(() => {
                this.syncGeometryHeights();
                this.buildCollider();

                // If car is currently clipping underneath new terrain, nudge it upward safely
                if (carBody) {
                    const t = carBody.translation();
                    const surfaceY = this.getHeightAt(t.x, t.z) + 0.45;
                    if (t.y < surfaceY) {
                        carBody.setTranslation({ x: t.x, y: surfaceY + 0.2, z: t.z }, true);
                    }
                }
            }, 50);
        }
    }

    // Query height at any world coordinate
    getHeightAt(x, z) {
        return getTerrainElevation(x, z, this.params);
    }

    // Query normal at any world coordinate
    getNormalAt(x, z) {
        return getTerrainNormal(x, z, this.params);
    }

    // Frame update for animation loop
    update(delta, sunPosition = null, sunColor = null, ambientColor = null) {
        if (!this.material || !this.material.uniforms) return;

        this.material.uniforms.uTime.value += delta;

        if (sunPosition) {
            this.material.uniforms.uLightDir.value.copy(sunPosition).normalize();
        }
        if (sunColor) {
            this.material.uniforms.uLightColor.value.copy(sunColor);
        }
        if (ambientColor) {
            this.material.uniforms.uAmbientColor.value.copy(ambientColor);
        }
    }

    dispose() {
        if (this.physicsRebuildTimeout) {
            clearTimeout(this.physicsRebuildTimeout);
        }

        if (this.world && this.collider) {
            this.world.removeCollider(this.collider, false);
            this.collider = null;
        }

        if (this.world && this.physicsBody) {
            this.world.removeRigidBody(this.physicsBody);
            this.physicsBody = null;
        }

        if (this.mesh) {
            this.scene.remove(this.mesh);
        }

        if (this.geometry) {
            this.geometry.dispose();
        }

        if (this.material) {
            this.material.dispose();
        }
    }
}
