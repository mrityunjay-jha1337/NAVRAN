import * as THREE from 'three';
import { useEffect, useRef, useState } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { useControls, button, folder, Leva } from 'leva';
import { Ground, DEFAULT_GROUND_CONFIG, drawPerlinNoiseRadar } from './Ground.js';

function ThreeScene() {
    const mountRef = useRef(null);
    const speedRef = useRef(null);
    const gearRef = useRef(null);
    const nitroBadgeRef = useRef(null);
    const cameraBadgeRef = useRef(null);
    const radarCanvasRef = useRef(null);
    const coordsRef = useRef(null);

    const [debugVisible, setDebugVisible] = useState(false);
    const debugVisibleRef = useRef(false);
    const [cameraMode, setCameraMode] = useState('auto'); // 'auto' | 'free_orbit'
    const cameraModeRef = useRef('auto');

    // References to active simulation entities
    const groundRef = useRef(null);
    const carBodyRef = useRef(null);
    const carSceneRef = useRef(null);

    // -------------------------------------------------------------
    // Leva Controls for Real-Time Smooth Perlin Noise Ground Tuning
    // -------------------------------------------------------------
    const groundParams = useControls('Terrain Settings', {
        'Procedural World': folder({
            seed: {
                value: DEFAULT_GROUND_CONFIG.seed,
                min: 1,
                max: 99999,
                step: 1,
                label: 'World Seed'
            },
            renderDistance: {
                value: DEFAULT_GROUND_CONFIG.renderDistance,
                min: 2,
                max: 6,
                step: 1,
                label: 'Render Radius (Chunks)'
            },
            showRadar: {
                value: true,
                label: 'Show Terrain Radar'
            },
            elevation: {
                value: DEFAULT_GROUND_CONFIG.elevation,
                min: 0.0,
                max: 80.0,
                step: 1.0,
                label: 'Height / Elevation'
            },
            frequency: {
                value: DEFAULT_GROUND_CONFIG.frequency,
                min: 0.003,
                max: 0.1,
                step: 0.001,
                label: 'Frequency / Scale'
            },
            octaves: {
                value: DEFAULT_GROUND_CONFIG.octaves,
                min: 1,
                max: 5,
                step: 1,
                label: 'Noise Octaves'
            },
            persistence: {
                value: DEFAULT_GROUND_CONFIG.persistence,
                min: 0.1,
                max: 0.7,
                step: 0.05,
                label: 'Roughness (Persistence)'
            },
            lacunarity: {
                value: DEFAULT_GROUND_CONFIG.lacunarity,
                min: 0.25,
                max: 2.0,
                step: 0.1,
                label: 'Lacunarity'
            },
            spawnFlatRadius: {
                value: DEFAULT_GROUND_CONFIG.spawnFlatRadius,
                min: 0.0,
                max: 100.0,
                step: 5.0,
                label: 'Spawn Plateau (m)'
            },
        }),
        'Ground Wireframe': folder({
            wireframeColor: {
                value: DEFAULT_GROUND_CONFIG.wireframeColor,
                label: 'Wireframe Color'
            },
            wireframe: {
                value: true,
                label: 'Show Ground Wireframe'
            },
        }),
        'Simulation Actions': folder({
            'Respawn Car (R)': button(() => {
                window.dispatchEvent(new CustomEvent('car:respawn'));
            }),
            'Rebuild Physics': button(() => {
                window.dispatchEvent(new CustomEvent('ground:rebuild-physics'));
            }),
        })
    });

    const carVisualParams = useControls('Vehicle Visuals', {
        carWireframe: {
            value: false,
            label: 'Car Wireframe Mode'
        }
    });
    const carVisualParamsRef = useRef(carVisualParams);

    // Toggle car wireframe reactively when changed in Leva
    const isCarWireframe = carVisualParams.carWireframe;
    useEffect(() => {
        carVisualParamsRef.current = carVisualParams;
        if (carSceneRef.current) {
            carSceneRef.current.traverse((child) => {
                if (child.isMesh && child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => { m.wireframe = isCarWireframe; });
                    } else {
                        child.material.wireframe = isCarWireframe;
                    }
                }
            });
        }
    }, [isCarWireframe, carVisualParams]);

    const tyreParams = useControls('Tyre Colliders', {
        colliderShape: {
            value: 'roundCylinder',
            options: {
                'Smooth Round Cylinder (Default)': 'roundCylinder',
                'Flat Cylinder': 'cylinder',
                'Smooth Capsule': 'capsule',
                'Sphere (Ball)': 'ball'
            },
            label: 'Collider Profile'
        },
        tyreWidth: {
            value: 0.24,
            min: 0.16,
            max: 0.32,
            step: 0.01,
            label: 'Tyre Width (m)'
        },
        shoulderBevel: {
            value: 0.025,
            min: 0.005,
            max: 0.05,
            step: 0.005,
            label: 'Shoulder Bevel (m)'
        },
        tyreRadius: {
            value: 0.315,
            min: 0.280,
            max: 0.350,
            step: 0.002,
            label: 'Tyre Radius (m)'
        },
        highSpeedDownforce: {
            value: 1.8,
            min: 0.0,
            max: 4.0,
            step: 0.1,
            label: 'Downforce Grip'
        },
        bounceDamper: {
            value: 1.2,
            min: 0.0,
            max: 3.0,
            step: 0.1,
            label: 'Bounce Absorption'
        }
    });

    const groundParamsRef = useRef(groundParams);
    const tyreParamsRef = useRef(tyreParams);
    const rebuildWheelCollidersRef = useRef(null);

    // Propagate Leva changes to active Ground instance
    useEffect(() => {
        groundParamsRef.current = groundParams;
        if (groundRef.current) {
            groundRef.current.updateParams(groundParams, carBodyRef.current);
        }
    }, [groundParams]);

    // Propagate Leva changes to wheel colliders in real time
    useEffect(() => {
        tyreParamsRef.current = tyreParams;
        if (rebuildWheelCollidersRef.current) {
            rebuildWheelCollidersRef.current(
                tyreParams.colliderShape,
                tyreParams.tyreWidth,
                tyreParams.shoulderBevel,
                tyreParams.tyreRadius
            );
        }
    }, [tyreParams]);

    // Keep refs in sync for animation loop
    useEffect(() => {
        debugVisibleRef.current = debugVisible;
    }, [debugVisible]);

    useEffect(() => {
        cameraModeRef.current = cameraMode;
    }, [cameraMode]);

    useEffect(() => {
        let isMounted = true;
        let animationId;
        let world = null;
        let carBody = null;
        let carScene = null;
        let ground = null;
        let lastTime = performance.now();

        // Driving Tuning Parameters (Tuned for smooth, realistic sports car physics)
        const CAR_MASS = 1500;                     // 1500 kg Real Car Mass
        const WHEEL_MASS = 25;                     // 25 kg per wheel
        const NORMAL_FORWARD_SPEED = 40;           // ~86 km/h normal cruising top speed
        const BOOST_FORWARD_SPEED = 100;            // ~151 km/h Turbo Nitro top speed
        const NORMAL_ACCEL_FORCE = CAR_MASS * 18;  // Responsive engine acceleration
        const BOOST_ACCEL_FORCE = CAR_MASS * 40;   // Explosive Turbo Nitro force
        const MAX_REVERSE_SPEED = 18;              // ~65 km/h max reverse
        const REVERSE_FORCE = CAR_MASS * 22;       // Strong reverse force
        const BRAKE_FORCE = CAR_MASS * 30;         // Active brake pedal force (S key)
        const COAST_DECEL = CAR_MASS * 1.0;        // Gentle natural coasting drag (~1.0 m/s²)
        const WHEELBASE = 2.55;                    // 2.55m distance between front & rear axles
        const WHEEL_RADIUS = 0.325;                // Matches wheel collider

        let prevCarCenter = null;
        let isDrivingState = false;
        let currentCamDir = -1.0; // -1.0 = behind car (forward), +1.0 = in front of car facing it (reverse)
        let currentFollowDist = 7.0; // Smoothly interpolated follow distance
        let currentFollowHeight = 2.1;
        let userHasManuallyOrbited = false;
        let steerFL = null;
        let steerFR = null;
        const wheels = [];
        let currentSteerAngle = 0;
        const dynamicObstacles = [];

        const container = mountRef.current;
        if (!container) return;

        // 1. Scene
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x181a1f);
        scene.fog = new THREE.Fog(0x181a1f, DEFAULT_GROUND_CONFIG.fogNear, DEFAULT_GROUND_CONFIG.fogFar);

        // 2. Camera (Starts behind car looking forward - GTA 3rd person chase)
        const camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        camera.position.set(-6.5, 2.85, 0);
        const currentLookTarget = new THREE.Vector3(3.5, 1.65, 0);
        camera.lookAt(currentLookTarget);

        // 3. Renderer with Soft Shadows
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(renderer.domElement);

        // Ensure canvas has focus so keyboard input works immediately
        renderer.domElement.tabIndex = 0;
        renderer.domElement.focus();

        // 4. OrbitControls (Available for 360° rotation when stationary)
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.enablePan = false; // Center orbit strictly on the car
        controls.target.set(0, 1.3, 0);
        controls.maxPolarAngle = Math.PI / 2 - 0.05; // Never dip below ground level
        controls.minPolarAngle = 0.08;
        controls.minDistance = 2.0;
        controls.maxDistance = 35.0;
        controls.enabled = true;

        const onOrbitStart = () => {
            userHasManuallyOrbited = true;
        };
        controls.addEventListener('start', onOrbitStart);

        // 5. Ground Surface Instance (Perlin Noise Shader & Visual Mesh)
        ground = new Ground(scene, groundParamsRef.current);
        groundRef.current = ground;

        // 6. Lighting with Dynamic Car-Proximity Shadow Mapping
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 2.6);
        const sunOffset = new THREE.Vector3(25, 40, 20);
        directionalLight.position.copy(sunOffset);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.near = 1.0;
        directionalLight.shadow.camera.far = 120.0;

        // Dynamic proximity bounds around the vehicle / camera
        const SHADOW_RADIUS = 35.0;
        directionalLight.shadow.camera.left = -SHADOW_RADIUS;
        directionalLight.shadow.camera.right = SHADOW_RADIUS;
        directionalLight.shadow.camera.top = SHADOW_RADIUS;
        directionalLight.shadow.camera.bottom = -SHADOW_RADIUS;
        directionalLight.shadow.bias = -0.0003;
        directionalLight.shadow.normalBias = 0.02; // Prevents shadow acne on car mesh curves
        scene.add(directionalLight);
        scene.add(directionalLight.target);

        // 7. Collider Debug Wireframe Visualizer
        const debugGeometry = new THREE.BufferGeometry();
        const debugMaterial = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            depthTest: false
        });
        const debugLines = new THREE.LineSegments(debugGeometry, debugMaterial);
        debugLines.renderOrder = 999;
        scene.add(debugLines);

        // 8. Respawn Function Helper (Spawns settled flush on ground with zero drop bounce)
        const respawnCar = () => {
            if (!carBody || !ground) return;
            const spawnY = ground.getHeightAt(0, 0) + 0.085;
            carBody.setTranslation({ x: 0, y: spawnY, z: 0 }, true);
            carBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
            carBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
            carBody.setAngvel({ x: 0, y: 0, z: 0 }, true);

            prevCarCenter = new THREE.Vector3(0, spawnY + 0.85, 0);
            isDrivingState = false;
            currentCamDir = -1.0;
            currentFollowDist = 7.0;
            currentFollowHeight = 2.1;
            userHasManuallyOrbited = false;
            camera.position.set(-6.8, spawnY + 2.4, 0);
            currentLookTarget.set(0, spawnY + 1.0, 0);
            camera.lookAt(currentLookTarget);
            controls.target.set(0, spawnY + 0.85, 0);
            controls.update();
        };

        const handleCarRespawn = () => {
            respawnCar();
        };

        const handleRebuildPhysics = () => {
            if (ground) {
                ground.syncGeometryHeights();
                ground.buildCollider();
            }
        };

        window.addEventListener('car:respawn', handleCarRespawn);
        window.addEventListener('ground:rebuild-physics', handleRebuildPhysics);

        // 9. Keyboard Controls State
        const keys = {
            w: false,
            s: false,
            a: false,
            d: false,
            shift: false
        };

        const handleKeyDown = (e) => {
            const k = e.key ? e.key.toLowerCase() : '';
            const code = e.code || '';

            // Prevent arrow keys or space from scrolling the page
            if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'space'].includes(k)) {
                e.preventDefault();
            }

            if (k === 'w' || code === 'KeyW' || k === 'arrowup' || code === 'ArrowUp') keys.w = true;
            if (k === 's' || code === 'KeyS' || k === 'arrowdown' || code === 'ArrowDown') keys.s = true;
            if (k === 'a' || code === 'KeyA' || k === 'arrowleft' || code === 'ArrowLeft') keys.a = true;
            if (k === 'd' || code === 'KeyD' || k === 'arrowright' || code === 'ArrowRight') keys.d = true;
            if (k === 'shift' || code === 'ShiftLeft' || code === 'ShiftRight' || e.shiftKey) keys.shift = true;

            // R: Reset car to ground position & reset camera
            if (k === 'r' || code === 'KeyR') {
                respawnCar();
            }

            // C: Toggle colliders wireframe
            if (k === 'c' || code === 'KeyC') {
                setDebugVisible(prev => !prev);
            }

            // V: Toggle Auto Hybrid (Orbit on stop, GTA on drive) vs Free Orbit
            if (k === 'v' || code === 'KeyV') {
                setCameraMode(prev => prev === 'auto' ? 'free_orbit' : 'auto');
            }
        };

        const handleKeyUp = (e) => {
            const k = e.key ? e.key.toLowerCase() : '';
            const code = e.code || '';

            if (k === 'w' || code === 'KeyW' || k === 'arrowup' || code === 'ArrowUp') keys.w = false;
            if (k === 's' || code === 'KeyS' || k === 'arrowdown' || code === 'ArrowDown') keys.s = false;
            if (k === 'a' || code === 'KeyA' || k === 'arrowleft' || code === 'ArrowLeft') keys.a = false;
            if (k === 'd' || code === 'KeyD' || k === 'arrowright' || code === 'ArrowRight') keys.d = false;
            if (k === 'shift' || code === 'ShiftLeft' || code === 'ShiftRight') keys.shift = false;
        };

        const handleBlur = () => {
            keys.w = false;
            keys.s = false;
            keys.a = false;
            keys.d = false;
            keys.shift = false;
        };

        const handleCanvasFocus = () => {
            renderer.domElement.focus();
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('blur', handleBlur);
        container.addEventListener('click', handleCanvasFocus);

        // 10. Asynchronously Initialize Rapier WASM & Create Physics World
        async function initPhysics() {
            try {
                // Await WASM initialization
                await RAPIER.init();
                if (!isMounted) return;

                // Realistic Gravity
                const gravity = { x: 0.0, y: -20.0, z: 0.0 };
                world = new RAPIER.World(gravity);

                // Solver Iterations for crisp, smooth collisions
                world.integrationParameters.numSolverIterations = 10;

                // Attach Ground Trimesh Physics Collider to Rapier Scene
                ground.createPhysics(world, RAPIER);

                // Dynamic Car RigidBody with CCD
                // Spawns smoothly resting right on the ground (contact at Y = 0.000m)
                const initialSpawnY = ground.getHeightAt(0, 0) + 0.085;
                const carBodyDesc = RAPIER.RigidBodyDesc.dynamic()
                    .setTranslation(0, initialSpawnY, 0)
                    .setLinearDamping(0.08)
                    .setAngularDamping(3.5)
                    .setCcdEnabled(true);
                carBody = world.createRigidBody(carBodyDesc);
                carBodyRef.current = carBody;

                // Chassis Collider (Zero restitution prevents bottom-out bouncing!)
                const chassisColliderDesc = RAPIER.ColliderDesc.cuboid(1.95, 0.38, 0.80)
                    .setTranslation(0.22, 0.70, 0)
                    .setRestitution(0.0) // Non-bouncy chassis
                    .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
                    .setMass(CAR_MASS)
                    .setFriction(0.1);
                world.createCollider(chassisColliderDesc, carBody);

                // Four Wheel Colliders with Smooth Unified Circular Geometry (Zero Subdivided Slices)
                const wheelOffsets = [
                    { name: 'Wheel_BL', x: -1.037, y: 0.232, z: -0.703 },
                    { name: 'Wheel_BR', x: -1.037, y: 0.232, z:  0.700 },
                    { name: 'Wheel_FL', x:  1.515, y: 0.232, z: -0.694 },
                    { name: 'Wheel_FR', x:  1.515, y: 0.232, z:  0.700 }
                ];

                let activeWheelColliders = [];
                // 90° rotation around X-axis so cylinder axis aligns with the wheel axle (Z-axis)
                const cylinderAxleRotation = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };

                function buildWheelColliders(shape = 'roundCylinder', width = 0.24, bevel = 0.025, targetRadius = 0.312) {
                    if (!world || !carBody) return;
                    activeWheelColliders.forEach(col => {
                        try {
                            world.removeCollider(col, false);
                        } catch {
                            // ignore already-removed colliders
                        }
                    });
                    activeWheelColliders = [];

                    wheelOffsets.forEach(w => {
                        let wheelColliderDesc;

                        if (shape === 'ball') {
                            wheelColliderDesc = RAPIER.ColliderDesc.ball(targetRadius);
                        } else if (shape === 'capsule') {
                            const capHalfHeight = Math.max(width / 2 - targetRadius, 0.01);
                            wheelColliderDesc = RAPIER.ColliderDesc.capsule(capHalfHeight, targetRadius)
                                .setRotation(cylinderAxleRotation);
                        } else if (shape === 'cylinder') {
                            const halfWidth = width / 2;
                            wheelColliderDesc = RAPIER.ColliderDesc.cylinder(halfWidth, targetRadius)
                                .setRotation(cylinderAxleRotation);
                        } else {
                            // Default: 'roundCylinder' - Smooth continuous circular cylinder with rounded bevel shoulders
                            // Prevents trimesh edge snagging and eliminates multiple sliced subdivisions
                            const roundRadius = Math.min(bevel, width * 0.45);
                            const halfWidth = Math.max(width / 2 - roundRadius, 0.01);
                            const cylRadius = Math.max(targetRadius - roundRadius, 0.05);
                            wheelColliderDesc = RAPIER.ColliderDesc.roundCylinder(halfWidth, cylRadius, roundRadius)
                                .setRotation(cylinderAxleRotation);
                        }

                        wheelColliderDesc
                            .setTranslation(w.x, w.y, w.z)
                            .setMass(WHEEL_MASS)
                            .setFriction(0.05)
                            .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
                            .setRestitution(0.0)
                            .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
                            .setContactSkin(0.002);

                        const col = world.createCollider(wheelColliderDesc, carBody);
                        activeWheelColliders.push(col);
                    });
                }

                rebuildWheelCollidersRef.current = buildWheelColliders;
                buildWheelColliders(
                    tyreParamsRef.current.colliderShape,
                    tyreParamsRef.current.tyreWidth,
                    tyreParamsRef.current.shoulderBevel,
                    tyreParamsRef.current.tyreRadius
                );

                // Obstacle Generator Helper (Smashable crates scattered along the terrain)
                function addObstacle(x, z, width = 1.5, height = 1.5, depth = 1.5, mass = 15, color = 0xd97736, yOffset = null) {
                    const terrainH = ground.getHeightAt(x, z);
                    const y = yOffset !== null ? terrainH + yOffset : terrainH + height / 2;

                    const geom = new THREE.BoxGeometry(width, height, depth);
                    const mat = new THREE.MeshStandardMaterial({
                        color: color,
                        roughness: 0.8,
                        metalness: 0.1
                    });
                    const mesh = new THREE.Mesh(geom, mat);
                    mesh.position.set(x, y, z);
                    mesh.castShadow = true;
                    mesh.receiveShadow = true;
                    scene.add(mesh);

                    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
                        .setTranslation(x, y, z)
                        .setLinearDamping(0.3)
                        .setAngularDamping(0.5)
                        .setCcdEnabled(true);
                    const body = world.createRigidBody(bodyDesc);

                    const colliderDesc = RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2)
                        .setFriction(0.2)
                        .setRestitution(0.4)
                        .setMass(mass);
                    world.createCollider(colliderDesc, body);

                    dynamicObstacles.push({ mesh, body });
                }

                // Stack of lightweight wooden crates ahead of car on the smooth surface
                addObstacle(11, -1.6, 1.4, 1.4, 1.4, 15, 0xd97736);
                addObstacle(11,  0.0, 1.4, 1.4, 1.4, 15, 0xc26227);
                addObstacle(11,  1.6, 1.4, 1.4, 1.4, 15, 0xd97736);
                addObstacle(11, -0.8, 1.4, 1.4, 1.4, 12, 0xe08b4c, 2.1);
                addObstacle(11,  0.8, 1.4, 1.4, 1.4, 12, 0xe08b4c, 2.1);

                // Scatter crates across nearby rolling hills
                addObstacle(18,  -7, 1.5, 1.5, 1.5, 15, 0x8a5d3b);
                addObstacle(18,   7, 1.5, 1.5, 1.5, 15, 0x8a5d3b);
                addObstacle(-12,  -8, 1.5, 1.5, 1.5, 15, 0x5a6375);
                addObstacle(-12,   8, 1.5, 1.5, 1.5, 15, 0x5a6375);

                // Load 3D Car GLB Model
                const loader = new GLTFLoader();
                loader.load(
                    '/car.glb',
                    (gltf) => {
                        if (!isMounted) return;
                        carScene = gltf.scene;
                        carSceneRef.current = carScene;
                        const isCarWire = carVisualParamsRef.current?.carWireframe ?? false;

                        carScene.position.set(0, initialSpawnY, 0);

                        carScene.traverse((child) => {
                            if (child.isMesh) {
                                child.castShadow = true;
                                child.receiveShadow = true;
                                if (child.material) {
                                    if (Array.isArray(child.material)) {
                                        child.material.forEach(m => { m.wireframe = isCarWire; });
                                    } else {
                                        child.material.wireframe = isCarWire;
                                    }
                                }
                            }
                        });

                        steerFL = carScene.getObjectByName('Steer_FL');
                        steerFR = carScene.getObjectByName('Steer_FR');

                        ['Wheel_FL', 'Wheel_FR', 'Wheel_BL', 'Wheel_BR'].forEach(name => {
                            const w = carScene.getObjectByName(name);
                            if (w) wheels.push(w);
                        });

                        scene.add(carScene);
                    },
                    undefined,
                    (error) => {
                        console.error(' [ThreeScene] Error loading /car.glb:', error);
                    }
                );

                // Start animation loop once physics is ready
                animate();

            } catch (err) {
                console.error(' [Rapier] Initialization error:', err);
            }
        }

        // 11. Animation & Driving Loop
        function animate() {
            if (!isMounted) return;
            animationId = requestAnimationFrame(animate);

            const now = performance.now();
            const delta = Math.min((now - lastTime) / 1000, 0.05);
            lastTime = now;

            if (ground) {
                const carPos = carBody ? carBody.translation() : { x: 0, z: 0 };
                ground.update(carPos, delta, directionalLight.position, directionalLight.color, ambientLight.color);
            }

            if (world) {
                if (carBody) {
                    const rot = carBody.rotation();
                    const carQuat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);

                    // Local car axes (+X is forward, +Z is right, +Y is up)
                    const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(carQuat);
                    const lateral = new THREE.Vector3(0, 0, 1).applyQuaternion(carQuat);
                    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(carQuat);

                    const linvel = carBody.linvel();
                    const currentVel = new THREE.Vector3(linvel.x, linvel.y, linvel.z);

                    const forwardSpeed = currentVel.dot(forward);
                    const lateralSpeed = currentVel.dot(lateral);
                    const absSpeed = Math.abs(forwardSpeed);

                    // 1. Progressive Lateral Tyre Grip (Smooth tracking, prevents slide down slopes)
                    if (Math.abs(lateralSpeed) > 0.01) {
                        const gripImpulse = -lateralSpeed * CAR_MASS * Math.min(10.0 * delta, 0.85);
                        carBody.applyImpulse({
                            x: lateral.x * gripImpulse,
                            y: lateral.y * gripImpulse,
                            z: lateral.z * gripImpulse
                        }, true);
                    }

                    // 2. Acceleration / Braking / Fast Reverse (W & S)
                    const isBoosting = keys.shift && keys.w;
                    const targetMaxSpeed = isBoosting ? BOOST_FORWARD_SPEED : NORMAL_FORWARD_SPEED;
                    const currentAccel = isBoosting ? BOOST_ACCEL_FORCE : NORMAL_ACCEL_FORCE;

                    if (keys.w) {
                        if (forwardSpeed < -0.1) {
                            const brakeForce = BRAKE_FORCE * 1.5 * delta;
                            carBody.applyImpulse({
                                x: forward.x * brakeForce,
                                y: forward.y * brakeForce,
                                z: forward.z * brakeForce
                            }, true);
                        } else if (forwardSpeed < targetMaxSpeed) {
                            const force = currentAccel * delta;
                            carBody.applyImpulse({
                                x: forward.x * force,
                                y: forward.y * force,
                                z: forward.z * force
                            }, true);
                        }
                    } else if (keys.s) {
                        if (forwardSpeed > 0.1) {
                            const brake = Math.min(BRAKE_FORCE * delta, forwardSpeed * CAR_MASS * 0.95);
                            carBody.applyImpulse({
                                x: -forward.x * brake,
                                y: -forward.y * brake,
                                z: -forward.z * brake
                            }, true);
                        } else if (forwardSpeed > -MAX_REVERSE_SPEED) {
                            const force = REVERSE_FORCE * delta;
                            carBody.applyImpulse({
                                x: -forward.x * force,
                                y: -forward.y * force,
                                z: -forward.z * force
                            }, true);
                        }
                    } else {
                        // Natural gentle coasting / rolling resistance
                        if (absSpeed > 0.05) {
                            const decel = Math.min(COAST_DECEL * delta, absSpeed * CAR_MASS * 0.5);
                            const decelDir = forwardSpeed > 0 ? -1 : 1;
                            carBody.applyImpulse({
                                x: forward.x * decel * decelDir,
                                y: forward.y * decel * decelDir,
                                z: forward.z * decel * decelDir
                            }, true);
                        } else {
                            const currentLinvel = carBody.linvel();
                            carBody.setLinvel({ x: 0, y: currentLinvel.y, z: 0 }, true);
                        }
                    }

                    // 3. Realistic Speed-Sensitive Steering with Framerate-Independent Damping
                    const speedKmh = absSpeed * 3.6;
                    const speedFactor = THREE.MathUtils.clamp(1.0 - (speedKmh / 110) * 0.78, 0.20, 1.0);
                    const maxSteerAngle = 0.30 * speedFactor;

                    let targetSteer = 0;
                    if (keys.a) targetSteer = maxSteerAngle;
                    if (keys.d) targetSteer = -maxSteerAngle;

                    const steerDampSpeed = (targetSteer === 0) ? 14.0 : 8.0;
                    currentSteerAngle = THREE.MathUtils.damp(currentSteerAngle, targetSteer, steerDampSpeed, delta);

                    if (steerFL) steerFL.rotation.y = currentSteerAngle;
                    if (steerFR) steerFR.rotation.y = currentSteerAngle;

                    // Turning with terrain-relative angular velocity
                    const angvel = carBody.angvel();
                    const currentAngVec = new THREE.Vector3(angvel.x, angvel.y, angvel.z);
                    const currentPitch = currentAngVec.dot(lateral);
                    const currentRoll = currentAngVec.dot(forward);
                    const currentYaw = currentAngVec.dot(up);

                    let targetYawRate = 0;
                    if (absSpeed > 0.15) {
                        const maxYawRate = THREE.MathUtils.damp(2.2, 1.0, 3.0, THREE.MathUtils.clamp(speedKmh / 90, 0, 1));
                        targetYawRate = (forwardSpeed / WHEELBASE) * Math.tan(currentSteerAngle);
                        targetYawRate = THREE.MathUtils.clamp(targetYawRate, -maxYawRate, maxYawRate);
                    }
                    const newYaw = THREE.MathUtils.damp(currentYaw, targetYawRate, 8.0, delta);
                    const newPitch = THREE.MathUtils.damp(currentPitch, 0.0, 1.5, delta);
                    const newRoll = THREE.MathUtils.damp(currentRoll, 0.0, 2.5, delta);

                    const newAngVec = new THREE.Vector3()
                        .addScaledVector(up, newYaw)
                        .addScaledVector(lateral, newPitch)
                        .addScaledVector(forward, newRoll);

                    carBody.setAngvel(newAngVec, true);

                    // Upright stabilization spring aligned with terrain normal (smoothly hugs slopes without bouncing)
                    let targetUp = new THREE.Vector3(0, 1, 0);
                    if (ground) {
                        const carTrans = carBody.translation();
                        const terrainH = ground.getHeightAt(carTrans.x, carTrans.z);
                        const clearance = carTrans.y - terrainH;
                        const groundNormal = ground.getNormalAt(carTrans.x, carTrans.z);
                        const groundFactor = THREE.MathUtils.clamp(1.0 - (clearance - 0.1) / 1.2, 0.0, 1.0);
                        targetUp.copy(groundNormal).multiplyScalar(groundFactor)
                            .addScaledVector(new THREE.Vector3(0, 1, 0), 1.0 - groundFactor).normalize();
                    }

                    const uprightDot = THREE.MathUtils.clamp(up.dot(targetUp), -1, 1);
                    const uprightAngle = Math.acos(uprightDot);
                    if (uprightAngle > 0.02) {
                        const correctionAxis = new THREE.Vector3().crossVectors(up, targetUp).normalize();
                        const angvelAlongAxis = angvel.x * correctionAxis.x + angvel.y * correctionAxis.y + angvel.z * correctionAxis.z;
                        const springTorque = uprightAngle * CAR_MASS * 5.0;
                        const dampingTorque = angvelAlongAxis * CAR_MASS * 0.45;
                        const netTorque = (springTorque - dampingTorque) * delta;
                        carBody.applyTorqueImpulse({
                            x: correctionAxis.x * netTorque,
                            y: correctionAxis.y * netTorque,
                            z: correctionAxis.z * netTorque
                        }, true);
                    }

                    // 4. Wheel Spin matched to distance
                    const rollDelta = (forwardSpeed * delta) / WHEEL_RADIUS;
                    wheels.forEach(wheel => {
                        wheel.rotateX(rollDelta);
                    });

                    // 4b. High-Speed Aerodynamic Downforce (Keeps car firmly planted on terrain, prevents bouncing at 100+ km/h)
                    const downforceFactor = tyreParamsRef.current.highSpeedDownforce ?? 1.8;
                    if (absSpeed > 5.0 && downforceFactor > 0) {
                        const downforce = (absSpeed * absSpeed) * downforceFactor * CAR_MASS * 0.0012;
                        carBody.applyImpulse({
                            x: -up.x * downforce * delta,
                            y: -up.y * downforce * delta,
                            z: -up.z * downforce * delta
                        }, true);
                    }

                    // 4c. Vertical Bounce Absorption (Suspension shock absorption when driving fast over rough terrain)
                    const bounceDamperVal = tyreParamsRef.current.bounceDamper ?? 1.2;
                    if (bounceDamperVal > 0 && ground) {
                        const carTrans = carBody.translation();
                        const groundH = ground.getHeightAt(carTrans.x, carTrans.z);
                        const groundClearance = carTrans.y - groundH;
                        // When near the terrain surface (< 0.65m) and experiencing sudden upward bounce (> 0.20 m/s)
                        if (groundClearance < 0.65 && linvel.y > 0.20) {
                            const reboundImpulse = linvel.y * CAR_MASS * Math.min(8.0 * bounceDamperVal * delta, 0.45);
                            carBody.applyImpulse({ x: 0, y: -reboundImpulse, z: 0 }, true);
                        }
                    }

                    // 5. Dynamic Camera FOV with smooth damping
                    const targetFov = isBoosting ? 80 : 75;
                    camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 4.0, delta);
                    camera.updateProjectionMatrix();

                    // Live HUD Updates
                    if (speedRef.current) {
                        speedRef.current.innerText = `${Math.round(speedKmh)}`;
                    }

                    if (gearRef.current) {
                        if (forwardSpeed < -0.3) {
                            gearRef.current.innerText = 'REV';
                            gearRef.current.className = 'text-xs font-mono font-bold text-amber-400';
                        } else if (absSpeed < 0.2) {
                            gearRef.current.innerText = 'NEUTRAL';
                            gearRef.current.className = 'text-xs font-mono font-bold text-neutral-400';
                        } else if (isBoosting) {
                            gearRef.current.innerText = 'NITRO 🔥';
                            gearRef.current.className = 'text-xs font-mono font-bold text-amber-400 animate-pulse';
                        } else {
                            gearRef.current.innerText = speedKmh > 55 ? 'GEAR 3' : speedKmh > 28 ? 'GEAR 2' : 'GEAR 1';
                            gearRef.current.className = 'text-xs font-mono font-bold text-emerald-400';
                        }
                    }

                    if (nitroBadgeRef.current) {
                        if (isBoosting) {
                            nitroBadgeRef.current.innerText = '🔥 TURBO ACTIVE';
                            nitroBadgeRef.current.className = 'text-xs font-bold px-2 py-0.5 rounded-md font-mono bg-gradient-to-r from-amber-500 to-orange-500 text-black font-extrabold shadow-[0_0_15px_rgba(245,158,11,0.9)] animate-pulse';
                        } else if (keys.shift) {
                            nitroBadgeRef.current.innerText = '⚡ HOLD W TO BOOST';
                            nitroBadgeRef.current.className = 'text-xs font-bold px-2 py-0.5 rounded-md font-mono bg-cyan-500/20 text-cyan-300 border border-cyan-500/40';
                        } else {
                            nitroBadgeRef.current.innerText = 'HOLD SHIFT';
                            nitroBadgeRef.current.className = 'text-xs font-bold px-2 py-0.5 rounded-md font-mono text-neutral-400 bg-white/5';
                        }
                    }
                }

                // Step physics simulation with adaptive substepping at high speeds to prevent tunnelling and terrain bounce
                const isHighSpeed = keys.shift && keys.w;
                const subSteps = isHighSpeed ? 2 : 1;
                world.timestep = delta / subSteps;
                for (let s = 0; s < subSteps; s++) {
                    world.step();
                }

                // Synchronize visual car with physics
                if (carScene && carBody) {
                    const translation = carBody.translation();
                    const rotation = carBody.rotation();
                    carScene.position.set(translation.x, translation.y, translation.z);
                    carScene.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

                    const carCenter = new THREE.Vector3(translation.x, translation.y + 0.85, translation.z);

                    // Dynamic Shadow Follow
                    directionalLight.target.position.copy(carCenter);
                    directionalLight.position.copy(carCenter).add(sunOffset);
                    directionalLight.target.updateMatrixWorld();

                    if (!prevCarCenter) {
                        prevCarCenter = carCenter.clone();
                    }
                    const carDelta = new THREE.Vector3().subVectors(carCenter, prevCarCenter);
                    prevCarCenter.copy(carCenter);
                    camera.position.add(carDelta);
                    currentLookTarget.add(carDelta);

                    // Safety net respawn: only if car falls through into the void
                    if (translation.y < -40.0) {
                        respawnCar();
                    }

                    const carQuat = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
                    const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(carQuat);

                    // Update live GPS coordinates & Seeded Perlin Noise Radar
                    if (coordsRef.current) {
                        coordsRef.current.innerText = `X: ${translation.x.toFixed(1)} | Z: ${translation.z.toFixed(1)} | Y: ${translation.y.toFixed(1)}m`;
                    }

                    if (radarCanvasRef.current && groundParamsRef.current.showRadar) {
                        const heading = Math.atan2(forward.x, -forward.z);
                        drawPerlinNoiseRadar(radarCanvasRef.current, translation.x, translation.z, heading, groundParamsRef.current, 180);
                    }

                    const linvel = carBody.linvel();
                    const currentVel = new THREE.Vector3(linvel.x, linvel.y, linvel.z);
                    const forwardSpeed = currentVel.dot(forward);
                    const currentSpeed = currentVel.length();

                    const isThrottleActive = keys.w || keys.s;
                    const isActuallyMoving = currentSpeed > 0.35;

                    if ((isThrottleActive && currentSpeed > 0.15) || isActuallyMoving) {
                        isDrivingState = true;
                        userHasManuallyOrbited = false;
                    } else if (!isThrottleActive && currentSpeed < 0.10) {
                        isDrivingState = false;
                    }

                    let targetCamDir;
                    if (keys.s && forwardSpeed < -0.15) {
                        targetCamDir = 1.0;
                    } else if (forwardSpeed < -0.7) {
                        targetCamDir = 1.0;
                    } else if (keys.w || forwardSpeed > 0.25) {
                        targetCamDir = -1.0;
                    } else {
                        targetCamDir = currentCamDir > 0 ? 1.0 : -1.0;
                    }

                    // Smooth framerate-independent camera direction damping
                    currentCamDir = THREE.MathUtils.damp(currentCamDir, targetCamDir, 6.0, delta);

                    const isBoosting = keys.shift && keys.w;

                    if (cameraBadgeRef.current) {
                        if (cameraModeRef.current === 'free_orbit') {
                            cameraBadgeRef.current.innerText = 'FREE ORBIT [V]';
                            cameraBadgeRef.current.className = 'text-xs font-mono font-bold text-purple-400';
                        } else if (isDrivingState) {
                            if (currentCamDir > 0.1) {
                                cameraBadgeRef.current.innerText = 'REVERSE FRONT 🎥';
                                cameraBadgeRef.current.className = 'text-xs font-mono font-bold text-amber-400';
                            } else {
                                cameraBadgeRef.current.innerText = 'CHASE REAR 🎥';
                                cameraBadgeRef.current.className = 'text-xs font-mono font-bold text-cyan-400';
                            }
                        } else {
                            cameraBadgeRef.current.innerText = 'ORBIT READY 🔄';
                            cameraBadgeRef.current.className = 'text-xs font-mono font-bold text-emerald-400';
                        }
                    }

                    const targetDist = isBoosting ? 8.2 : 7.0;
                    const targetHeight = isBoosting ? 2.3 : 2.1;
                    currentFollowDist = THREE.MathUtils.damp(currentFollowDist, targetDist, 3.5, delta);
                    currentFollowHeight = THREE.MathUtils.damp(currentFollowHeight, targetHeight, 3.5, delta);

                    const lateralCam = new THREE.Vector3(-forward.z, 0, forward.x);
                    const arcSide = (1.0 - currentCamDir * currentCamDir) * (currentFollowDist * 0.7);

                    const desiredCamPos = new THREE.Vector3()
                        .copy(carCenter)
                        .addScaledVector(forward, currentCamDir * currentFollowDist)
                        .addScaledVector(lateralCam, arcSide);
                    desiredCamPos.y = carCenter.y + (currentFollowHeight - 0.85);

                    // Camera collision avoidance with smooth Perlin ground hills
                    if (ground) {
                        const camTerrainH = ground.getHeightAt(desiredCamPos.x, desiredCamPos.z);
                        if (desiredCamPos.y < camTerrainH + 0.8) {
                            desiredCamPos.y = camTerrainH + 0.8;
                        }
                    }

                    const carTargetLook = new THREE.Vector3(carCenter.x, carCenter.y + 0.55, carCenter.z);

                    if (cameraModeRef.current === 'free_orbit') {
                        controls.enabled = true;
                        controls.target.copy(carCenter);
                        controls.update();
                        currentLookTarget.copy(controls.target);
                    } else if (isDrivingState) {
                        controls.enabled = false;

                        // Framerate-independent camera position damping
                        camera.position.x = THREE.MathUtils.damp(camera.position.x, desiredCamPos.x, 10.0, delta);
                        camera.position.y = THREE.MathUtils.damp(camera.position.y, desiredCamPos.y, 10.0, delta);
                        camera.position.z = THREE.MathUtils.damp(camera.position.z, desiredCamPos.z, 10.0, delta);

                        const toCamNow = new THREE.Vector3().subVectors(camera.position, carCenter);
                        toCamNow.y = 0;
                        const currentDist = toCamNow.length();
                        const maxAllowedDist = currentFollowDist * 1.06;
                        if (currentDist > maxAllowedDist && currentDist > 0.01) {
                            toCamNow.normalize().multiplyScalar(maxAllowedDist);
                            camera.position.x = carCenter.x + toCamNow.x;
                            camera.position.z = carCenter.z + toCamNow.z;
                        }

                        // Framerate-independent look target damping
                        currentLookTarget.x = THREE.MathUtils.damp(currentLookTarget.x, carTargetLook.x, 14.0, delta);
                        currentLookTarget.y = THREE.MathUtils.damp(currentLookTarget.y, carTargetLook.y, 14.0, delta);
                        currentLookTarget.z = THREE.MathUtils.damp(currentLookTarget.z, carTargetLook.z, 14.0, delta);

                        camera.lookAt(currentLookTarget);
                        controls.target.copy(carCenter);

                    } else {
                        controls.enabled = true;
                        controls.target.copy(carCenter);

                        if (userHasManuallyOrbited) {
                            controls.update();
                            currentLookTarget.copy(controls.target);
                        } else {
                            // Framerate-independent smooth settle damping when coming to rest
                            camera.position.x = THREE.MathUtils.damp(camera.position.x, desiredCamPos.x, 6.0, delta);
                            camera.position.y = THREE.MathUtils.damp(camera.position.y, desiredCamPos.y, 6.0, delta);
                            camera.position.z = THREE.MathUtils.damp(camera.position.z, desiredCamPos.z, 6.0, delta);

                            currentLookTarget.x = THREE.MathUtils.damp(currentLookTarget.x, carTargetLook.x, 8.0, delta);
                            currentLookTarget.y = THREE.MathUtils.damp(currentLookTarget.y, carTargetLook.y, 8.0, delta);
                            currentLookTarget.z = THREE.MathUtils.damp(currentLookTarget.z, carTargetLook.z, 8.0, delta);

                            camera.lookAt(currentLookTarget);

                            if (camera.position.distanceTo(desiredCamPos) < 0.04 && currentLookTarget.distanceTo(carCenter) < 0.04) {
                                controls.update();
                            }
                        }
                    }
                }

                // Synchronize dynamic obstacles
                dynamicObstacles.forEach(({ mesh, body }) => {
                    const t = body.translation();
                    const r = body.rotation();
                    mesh.position.set(t.x, t.y, t.z);
                    mesh.quaternion.set(r.x, r.y, r.z, r.w);
                });

                // Debug Colliders Wireframe Rendering
                if (debugVisibleRef.current) {
                    debugLines.visible = true;
                    const buffers = world.debugRender();
                    debugGeometry.setAttribute('position', new THREE.BufferAttribute(buffers.vertices, 3));
                    debugGeometry.setAttribute('color', new THREE.BufferAttribute(buffers.colors, 4));
                } else {
                    debugLines.visible = false;
                }
            }

            renderer.render(scene, camera);
        }

        initPhysics();

        // 12. Resize Handler
        function handleResize() {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        }

        window.addEventListener('resize', handleResize);

        // 13. Safe Cleanup
        return () => {
            isMounted = false;
            cancelAnimationFrame(animationId);
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', handleBlur);
            window.removeEventListener('car:respawn', handleCarRespawn);
            window.removeEventListener('ground:rebuild-physics', handleRebuildPhysics);
            rebuildWheelCollidersRef.current = null;
            carSceneRef.current = null;

            if (ground) {
                ground.dispose();
                ground = null;
                groundRef.current = null;
            }

            debugGeometry.dispose();
            debugMaterial.dispose();
            if (directionalLight.shadow.map) {
                directionalLight.shadow.map.dispose();
            }
            controls.removeEventListener('start', onOrbitStart);
            controls.dispose();
            renderer.dispose();

            if (renderer.domElement && renderer.domElement.parentNode) {
                renderer.domElement.parentNode.removeChild(renderer.domElement);
            }
        };

    }, []);

    return (
        <div className="fixed inset-0 w-full h-full overflow-hidden select-none font-sans">
            {/* 3D WebGL Canvas */}
            <div ref={mountRef} className="w-full h-full" />

            
            {/* Bottom-Left Speedometer & Driving HUD */}
            <div className="absolute top-6 left-6 pointer-events-none  z-10 flex flex-col gap-2">
                <div className="flex items-baseline gap-2 bg-neutral-900/85 backdrop-blur-md border border-white/10 mx-auto flex flex-center py-10 rounded-2xl px-5 py-3 shadow-2xl">
                    <span ref={speedRef} className="text-5xl font-mono font-black tracking-tight text-white">0</span>
                    <span className="text-sm font-mono font-bold text-neutral-400">KM/H</span>
                    <div className="ml-4 pl-4 border-l border-white/10 flex flex-col">
                    </div>
                </div>
                
            </div>

            {/* Bottom-Right Seeded Perlin Noise Radar Mini-Map */}
            {groundParams.showRadar && (
                <div className="absolute bottom-6 right-6 pointer-events-none z-10 flex flex-col items-end gap-1.5">
                    <div className="relative p-2 rounded-2xl bg-neutral-900/85 backdrop-blur-md border border-white/15 shadow-2xl flex flex-col items-center">
                
                        <canvas
                            ref={radarCanvasRef}
                            width={160}
                            height={160}
                            className="w-[160px] h-[160px] mt-1.5 rounded-full shadow-inner"
                        />
                        <div ref={coordsRef} className="mt-1.5 text-[10px] font-mono text-neutral-400">
                            X: 0.0 | Z: 0.0 | Y: 0.0m
                        </div>
                    </div>
                </div>
            )}

            {/* Leva GUI Control Panel Config */}
            <Leva
                titleBar={{ title: 'Infinite Ground & Perlin World' }}
                collapsed={true}
                oneLineLabels={false}
            />
        </div>
    );
}

export default ThreeScene;
