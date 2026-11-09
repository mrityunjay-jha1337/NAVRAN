import * as THREE from 'three';
import { useEffect, useRef, useState } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { useControls, button, folder, Leva } from 'leva';
import { Ground, DEFAULT_GROUND_CONFIG, drawPerlinNoiseRadar, getRandomSeed } from './Ground.js';
import {
    Road,
    DEFAULT_ROAD_CONFIG,
    getProceduralRoadCurve,
    getProceduralRoadElevation,
    projectToNearestRoadPoint,
    sampleForwardRoadTarget,
    computeRayDistanceToRoadEdge,
} from './Road.js';
import { createTargetBeacon } from './TargetBeacon.js';
import * as ort from 'onnxruntime-web';

function ThreeScene() {
    const mountRef = useRef(null);
    const speedRef = useRef(null);
    const gearRef = useRef(null);
    const nitroBadgeRef = useRef(null);
    const cameraBadgeRef = useRef(null);
    const speedBlurRef = useRef(null);
    const radarCanvasRef = useRef(null);
    const coordsRef = useRef(null);
    const targetBadgeRef = useRef(null);
    const aiBadgeRef = useRef(null);

    const [debugVisible, setDebugVisible] = useState(false);
    const debugVisibleRef = useRef(false);
    const [cameraMode, setCameraMode] = useState('auto'); // 'auto' | 'free_orbit'
    const cameraModeRef = useRef('auto');
    const [aiDriverActive, setAiDriverActive] = useState(false);
    const aiDriverActiveRef = useRef(false);
    const targetCoordRef = useRef({ x: 120, y: 0, z: 0 });
    const targetDistRef = useRef(0);

    // References to active simulation entities
    const groundRef = useRef(null);
    const roadRef = useRef(null);
    const carBodyRef = useRef(null);
    const carSceneRef = useRef(null);
    const setGroundParamsRef = useRef(null);

    // -------------------------------------------------------------
    // Leva Controls for Real-Time Smooth Perlin Noise Ground Tuning
    // -------------------------------------------------------------
    const [groundParams, setGroundParams] = useControls('Terrain Settings', () => ({
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
            'Randomize World (New Seed) 🎲': button(() => {
                const newSeed = getRandomSeed();
                if (setGroundParamsRef.current) {
                    setGroundParamsRef.current({ seed: newSeed });
                }
            }),
            'Respawn Car (R)': button(() => {
                window.dispatchEvent(new CustomEvent('car:respawn'));
            }),
            'Rebuild Physics': button(() => {
                window.dispatchEvent(new CustomEvent('ground:rebuild-physics'));
            }),
        })
    }), []);
    useEffect(() => {
        setGroundParamsRef.current = setGroundParams;
    }, [setGroundParams]);

    const roadParams = useControls('Mountain Road & Curves', {
        roadCarve: {
            value: DEFAULT_GROUND_CONFIG.roadCarve ?? true,
            label: 'Carve Road in Mountains'
        },
        showRoadMesh: {
            value: DEFAULT_ROAD_CONFIG.showRoadMesh ?? true,
            label: 'Show Road Wireframe'
        },
        roadWireframeColor: {
            value: DEFAULT_ROAD_CONFIG.roadWireframeColor ?? '#00a2ff',
            label: 'Road Wireframe Color'
        },
        roadWidth: {
            value: DEFAULT_GROUND_CONFIG.roadWidth ?? 32.0,
            min: 16.0,
            max: 50.0,
            step: 1.0,
            label: 'Road Width (m)'
        },
        shoulderWidth: {
            value: DEFAULT_GROUND_CONFIG.shoulderWidth ?? 20.0,
            min: 8.0,
            max: 35.0,
            step: 1.0,
            label: 'Mountain Bank Width (m)'
        },
        roadElevationScale: {
            value: DEFAULT_GROUND_CONFIG.roadElevationScale ?? 1.0,
            min: 0.2,
            max: 2.5,
            step: 0.1,
            label: 'Uphill/Downhill Scale'
        }
    });
    const roadParamsRef = useRef(roadParams);

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
            value: 0.4,
            min: 0.0,
            max: 3.0,
            step: 0.1,
            label: 'Bounce Absorption'
        }
    });

    const drivingDynamics = useControls('Vehicle Dynamics & FX', {
        driftPhysics: {
            value: true,
            label: 'Drift Dynamics'
        },
        screenShake: {
            value: true,
            label: 'Shift Screen Shake'
        },
        shakeIntensity: {
            value: 1.0,
            min: 0.2,
            max: 2.5,
            step: 0.1,
            label: 'Shake Multiplier'
        },
        speedBlur: {
            value: true,
            label: 'Shift Speed Background Blur'
        }
    });

    useControls('Autonomous AI Driver 🤖', {
        'AI Pilot Engaged (Key: T)': {
            value: aiDriverActive,
            label: 'Autonomous Mode',
            onChange: (val) => setAiDriverActive(val)
        },
        'New Target Beacon': button(() => {
            window.dispatchEvent(new CustomEvent('car:new-target'));
        })
    });

    const groundParamsRef = useRef(groundParams);
    const tyreParamsRef = useRef(tyreParams);
    const drivingDynamicsRef = useRef(drivingDynamics);
    const rebuildWheelCollidersRef = useRef(null);

    useEffect(() => {
        drivingDynamicsRef.current = drivingDynamics;
    }, [drivingDynamics]);

    // Propagate Leva changes to active Ground & Road instances
    useEffect(() => {
        roadParamsRef.current = roadParams;
        const mergedGroundParams = { ...groundParams, ...roadParams };
        groundParamsRef.current = mergedGroundParams;
        if (groundRef.current) {
            groundRef.current.updateParams(mergedGroundParams, carBodyRef.current);
        }
        if (roadRef.current) {
            roadRef.current.updateConfig({
                seed: groundParams.seed,
                roadWidth: roadParams.roadWidth,
                shoulderWidth: roadParams.shoulderWidth,
                elevationScale: roadParams.roadElevationScale,
                showRoadMesh: roadParams.showRoadMesh,
                roadWireframeColor: roadParams.roadWireframeColor,
            });
        }
    }, [groundParams, roadParams]);

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
        aiDriverActiveRef.current = aiDriverActive;
    }, [aiDriverActive]);

    useEffect(() => {
        let isMounted = true;
        let animationId;
        let world = null;
        let carBody = null;
        let carScene = null;
        let ground = null;
        let road = null;
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

        // Screen Shake & Drift Dynamic State Variables
        const baseCamPos = new THREE.Vector3(-6.5, 2.85, 0);
        let userZoomDist = 7.0; // Interactive scroll wheel zoom distance (default 7.0m)
        let currentShakeIntensity = 0;
        let screenShakePunch = 0;
        let shakeTime = 0;
        let currentDriftFactor = 0;
        let visualRollAngle = 0;
        let currentSpeedBlur = 0;

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

        // 4d. Neural Network ONNX Web Inference Engine
        const aiInputBuffer = new Float32Array(30);
        let onnxSession = null;
        let isInferring = false;
        let aiActionOutput = [0.0, 0.0, -1.0];

        // Load the trained neural network actor policy
        ort.InferenceSession.create('/models/car_agent.onnx', {
            executionProviders: ['wasm']
        }).then(session => {
            onnxSession = session;
            console.log('[ONNX Web] Autonomous Driving Policy loaded successfully from /models/car_agent.onnx');
        }).catch(err => {
            console.warn('[ONNX Web] Model loading deferred (using heuristic pursuit controller):', err);
        });

        // 5. Ground Surface Instance (Perlin Noise Shader & Visual Mesh)
        ground = new Ground(scene, groundParamsRef.current);
        groundRef.current = ground;

        // 5b. Mountain Pass Road (Infinite Blue Wireframe Ribbon)
        road = new Road(scene, {
            seed: groundParamsRef.current.seed,
            roadWidth: roadParamsRef.current.roadWidth,
            shoulderWidth: roadParamsRef.current.shoulderWidth,
            elevationScale: roadParamsRef.current.roadElevationScale,
            showRoadMesh: roadParamsRef.current.showRoadMesh,
            roadWireframeColor: roadParamsRef.current.roadWireframeColor,
        });
        roadRef.current = road;

        // 5c. Holographic Target Beacon Component
        const targetBeacon = createTargetBeacon();
        scene.add(targetBeacon.mesh);
        let currentTarget = sampleForwardRoadTarget(0.0, groundParamsRef.current.seed);
        targetCoordRef.current = currentTarget;

        const handleNewTarget = () => {
            const carPos = carBody ? carBody.translation() : { x: 0 };
            currentTarget = sampleForwardRoadTarget(carPos.x, groundParamsRef.current.seed);
            targetCoordRef.current = currentTarget;
        };
        window.addEventListener('car:new-target', handleNewTarget);

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

        // 7b. Real-time Autonomous LiDAR Laser Rays & Target Radar Visualizer
        const LIDAR_BEAMS_COUNT = 9;
        const TOTAL_RADAR_BEAMS = LIDAR_BEAMS_COUNT + 1; // 9 boundary rays + 1 target beacon lock ray
        const lidarPositions = new Float32Array(TOTAL_RADAR_BEAMS * 2 * 3);
        const lidarColors = new Float32Array(TOTAL_RADAR_BEAMS * 2 * 3);
        const lidarGeometry = new THREE.BufferGeometry();
        lidarGeometry.setAttribute('position', new THREE.BufferAttribute(lidarPositions, 3));
        lidarGeometry.setAttribute('color', new THREE.BufferAttribute(lidarColors, 3));

        const lidarMaterial = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.95,
            depthTest: false
        });
        const lidarLines = new THREE.LineSegments(lidarGeometry, lidarMaterial);
        lidarLines.renderOrder = 998;
        lidarLines.visible = false;
        scene.add(lidarLines);

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
            userZoomDist = 7.0;
            currentFollowDist = 7.0;
            currentFollowHeight = 2.1;
            userHasManuallyOrbited = false;
            baseCamPos.set(-6.8, spawnY + 2.4, 0);
            camera.position.copy(baseCamPos);
            currentLookTarget.set(0, spawnY + 1.0, 0);
            camera.lookAt(currentLookTarget);
            controls.target.set(0, spawnY + 0.85, 0);
            controls.update();
            currentShakeIntensity = 0;
            screenShakePunch = 0;
            currentDriftFactor = 0;
            visualRollAngle = 0;
            currentSpeedBlur = 0;
            if (speedBlurRef.current) speedBlurRef.current.style.opacity = '0';
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
            shift: false,
            space: false
        };

        const handleKeyDown = (e) => {
            const k = e.key ? e.key.toLowerCase() : '';
            const code = e.code || '';

            // Prevent arrow keys or space from scrolling the page
            if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'space', ' '].includes(k) || code === 'Space') {
                e.preventDefault();
            }

            if (k === 'w' || code === 'KeyW' || k === 'arrowup' || code === 'ArrowUp') {
                if (!keys.w && keys.shift) {
                    screenShakePunch = 0.045;
                }
                keys.w = true;
            }
            if (k === 's' || code === 'KeyS' || k === 'arrowdown' || code === 'ArrowDown') keys.s = true;
            if (k === 'a' || code === 'KeyA' || k === 'arrowleft' || code === 'ArrowLeft') keys.a = true;
            if (k === 'd' || code === 'KeyD' || k === 'arrowright' || code === 'ArrowRight') keys.d = true;
            if (k === ' ' || code === 'Space') keys.space = true;
            if (k === 'shift' || code === 'ShiftLeft' || code === 'ShiftRight' || e.shiftKey) {
                // Tactical punch only if W is also pressed (Shift without W does not trigger boost)
                if (!keys.shift && keys.w) {
                    screenShakePunch = 0.045;
                }
                keys.shift = true;
            }

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

            // T: Toggle Autonomous AI Driving mode
            if (k === 't' || code === 'KeyT') {
                setAiDriverActive(prev => !prev);
            }
        };

        const handleKeyUp = (e) => {
            const k = e.key ? e.key.toLowerCase() : '';
            const code = e.code || '';

            if (k === 'w' || code === 'KeyW' || k === 'arrowup' || code === 'ArrowUp') keys.w = false;
            if (k === 's' || code === 'KeyS' || k === 'arrowdown' || code === 'ArrowDown') keys.s = false;
            if (k === 'a' || code === 'KeyA' || k === 'arrowleft' || code === 'ArrowLeft') keys.a = false;
            if (k === 'd' || code === 'KeyD' || k === 'arrowright' || code === 'ArrowRight') keys.d = false;
            if (k === ' ' || code === 'Space') keys.space = false;
            if (k === 'shift' || code === 'ShiftLeft' || code === 'ShiftRight') keys.shift = false;
        };

        const handleBlur = () => {
            keys.w = false;
            keys.s = false;
            keys.a = false;
            keys.d = false;
            keys.shift = false;
            keys.space = false;
        };

        const handleCanvasFocus = () => {
            renderer.domElement.focus();
        };

        // Zoom In / Out with Mouse Scroll Wheel
        const handleWheel = (e) => {
            const zoomDelta = e.deltaY * 0.005;
            userZoomDist = THREE.MathUtils.clamp(userZoomDist + zoomDelta, 4.0, 24.0);
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('blur', handleBlur);
        window.addEventListener('wheel', handleWheel, { passive: true });
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

            if (road && carBody) {
                road.update(carBody.translation());
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
                    const speedKmh = absSpeed * 3.6;

                    // Target Beacon update & arrival detection
                    let localDx = 0;
                    let localDz = 0;
                    if (targetBeacon) {
                        targetBeacon.updatePosition(currentTarget.x, currentTarget.y, currentTarget.z);
                        targetBeacon.animate(delta);

                        const carPos = carBody.translation();
                        const carYaw = Math.atan2(forward.z, forward.x);
                        const tdx = currentTarget.x - carPos.x;
                        const tdz = currentTarget.z - carPos.z;
                        const tdist = Math.hypot(tdx, tdz);
                        targetDistRef.current = tdist;

                        localDx = tdx * Math.cos(carYaw) + tdz * Math.sin(carYaw);
                        localDz = -tdx * Math.sin(carYaw) + tdz * Math.cos(carYaw);

                        // Advance target if within 8.0m OR if car has passed the waypoint longitudinally
                        if (tdist < 8.0 || localDx < 4.0 || (currentTarget.x - carPos.x) < 2.0) {
                            currentTarget = sampleForwardRoadTarget(carPos.x, groundParamsRef.current.seed);
                            targetCoordRef.current = currentTarget;
                        }

                        // Assemble complete 30-D Observation Space (Section 4 of plan.md)
                        const rayAngles = [-1.309, -0.785, -0.523, -0.261, 0.0, 0.261, 0.523, 0.785, 1.309];
                        for (let i = 0; i < 9; i++) {
                            const rawDist = computeRayDistanceToRoadEdge(carPos.x, carPos.z, carYaw + rayAngles[i], groundParamsRef.current.seed, 16.0, 60.0);
                            aiInputBuffer[i] = rawDist / 60.0;

                            if (aiDriverActiveRef.current) {
                                const pIdx = i * 6;
                                lidarPositions[pIdx] = carPos.x;
                                lidarPositions[pIdx + 1] = carPos.y + 0.35;
                                lidarPositions[pIdx + 2] = carPos.z;

                                const rayH = carYaw + rayAngles[i];
                                const endX = carPos.x + Math.cos(rayH) * rawDist;
                                const endZ = carPos.z + Math.sin(rayH) * rawDist;
                                const endY = ground ? ground.getHeightAt(endX, endZ) + 0.25 : carPos.y;

                                lidarPositions[pIdx + 3] = endX;
                                lidarPositions[pIdx + 4] = endY;
                                lidarPositions[pIdx + 5] = endZ;

                                const isDanger = rawDist < 8.0;
                                const r = isDanger ? 1.0 : 0.05;
                                const g = isDanger ? 0.2 : 0.95;
                                const b = isDanger ? 0.3 : 0.85;

                                lidarColors[pIdx] = r; lidarColors[pIdx + 1] = g; lidarColors[pIdx + 2] = b;
                                lidarColors[pIdx + 3] = r; lidarColors[pIdx + 4] = g; lidarColors[pIdx + 5] = b;
                            }
                        }

                        if (aiDriverActiveRef.current) {
                            // 10th Beam: Holographic Target Beacon Radar Lock Beam
                            const tIdx = 9 * 6;
                            lidarPositions[tIdx] = carPos.x;
                            lidarPositions[tIdx + 1] = carPos.y + 0.55;
                            lidarPositions[tIdx + 2] = carPos.z;

                            lidarPositions[tIdx + 3] = currentTarget.x;
                            lidarPositions[tIdx + 4] = currentTarget.y + 1.2;
                            lidarPositions[tIdx + 5] = currentTarget.z;

                            lidarColors[tIdx] = 1.0; lidarColors[tIdx + 1] = 0.85; lidarColors[tIdx + 2] = 0.0;
                            lidarColors[tIdx + 3] = 0.2; lidarColors[tIdx + 4] = 1.0; lidarColors[tIdx + 5] = 0.5;

                            lidarGeometry.attributes.position.needsUpdate = true;
                            lidarGeometry.attributes.color.needsUpdate = true;
                            lidarLines.visible = true;
                        } else {
                            lidarLines.visible = false;
                        }
                        const lookaheads = [5.0, 15.0, 30.0, 55.0];
                        for (let i = 0; i < 4; i++) {
                            const lx = carPos.x + forward.x * lookaheads[i];
                            const road = getProceduralRoadCurve(lx, groundParamsRef.current.seed);
                            aiInputBuffer[9 + i] = THREE.MathUtils.clamp((road.z - carPos.z) / 16.0, -1.0, 1.0);
                            const roadAngle = Math.atan2(road.dz, 1.0);
                            aiInputBuffer[13 + i] = THREE.MathUtils.clamp(roadAngle - carYaw, -1.0, 1.0);
                        }
                        aiInputBuffer[17] = THREE.MathUtils.clamp(forwardSpeed / 45.0, -1.0, 1.0);
                        aiInputBuffer[18] = THREE.MathUtils.clamp(lateralSpeed / 15.0, -1.0, 1.0);
                        const currentAngvel = carBody.angvel();
                        aiInputBuffer[19] = THREE.MathUtils.clamp(-currentAngvel.y / 3.0, -1.0, 1.0);
                        aiInputBuffer[20] = THREE.MathUtils.clamp(-currentSteerAngle / 0.40, -1.0, 1.0);
                        aiInputBuffer[21] = (getProceduralRoadElevation(carPos.x + 5.0, groundParamsRef.current.seed) - carPos.y) / 5.0;
                        aiInputBuffer[22] = (getProceduralRoadElevation(carPos.x + 15.0, groundParamsRef.current.seed) - carPos.y) / 15.0;
                        aiInputBuffer[23] = (getProceduralRoadElevation(carPos.x + 35.0, groundParamsRef.current.seed) - carPos.y) / 35.0;
                        aiInputBuffer[24] = THREE.MathUtils.clamp((delta - 0.0166) / 0.01, -1.0, 1.0);
                        aiInputBuffer[25] = THREE.MathUtils.clamp(tdist / 300.0, 0.0, 1.0);
                        aiInputBuffer[26] = THREE.MathUtils.clamp(localDx / 300.0, -1.0, 1.0);
                        aiInputBuffer[27] = THREE.MathUtils.clamp(localDz / 16.0, -1.0, 1.0);
                        aiInputBuffer[28] = Math.atan2(localDz, Math.max(localDx, 1e-4)) / Math.PI;
                        const groundH = ground ? ground.getHeightAt(carPos.x, carPos.z) : 0.0;
                        aiInputBuffer[29] = (carPos.y - groundH) > 0.9 ? 1.0 : 0.0;

                        // Non-blocking real-time ONNX SIMD inference (<0.05ms)
                        if (aiDriverActiveRef.current && onnxSession && !isInferring) {
                            isInferring = true;
                            const inputTensor = new ort.Tensor('float32', aiInputBuffer, [1, 30]);
                            onnxSession.run({ observation: inputTensor }).then(res => {
                                aiActionOutput = res.action.data;
                                isInferring = false;
                            }).catch(() => {
                                isInferring = false;
                            });
                        }
                    }

                    // 1. Drift Physics & Lateral Grip Modulation
                    const driftEnabled = drivingDynamicsRef.current?.driftPhysics ?? true;
                    const hasSteerInput = Math.abs(currentSteerAngle) > 0.05;
                    const isHandbrake = keys.space;
                    const isBrakeDrift = keys.s && forwardSpeed > 4.0 && hasSteerInput;
                    const isPowerSlide = (keys.shift && keys.w && hasSteerInput && speedKmh > 20.0) || (hasSteerInput && speedKmh > 36.0);
                    const isAlreadySliding = Math.abs(lateralSpeed) > 1.3 && absSpeed > 3.0;

                    let wantsDrift = false;
                    if (driftEnabled && absSpeed > 2.0) {
                        if (isHandbrake || isBrakeDrift || isPowerSlide || isAlreadySliding) {
                            wantsDrift = true;
                        }
                    }

                    const targetDriftFactor = wantsDrift ? 1.0 : 0.0;
                    const driftTransitionSpeed = wantsDrift ? 10.0 : 4.5;
                    currentDriftFactor = THREE.MathUtils.damp(currentDriftFactor, targetDriftFactor, driftTransitionSpeed, delta);

                    // Dynamic lateral tyre friction:
                    // Normal grip cancels 85% of lateral speed per frame (smooth tracking).
                    // In drift, grip drops to ~20%, allowing the vehicle to slide sideways with momentum while retaining control!
                    if (Math.abs(lateralSpeed) > 0.01) {
                        const maxGrip = THREE.MathUtils.lerp(0.85, 0.20, currentDriftFactor);
                        const gripRate = THREE.MathUtils.lerp(10.0, 3.5, currentDriftFactor);
                        const gripImpulse = -lateralSpeed * CAR_MASS * Math.min(gripRate * delta, maxGrip);
                        carBody.applyImpulse({
                            x: lateral.x * gripImpulse,
                            y: lateral.y * gripImpulse,
                            z: lateral.z * gripImpulse
                        }, true);
                    }

                    // Handbrake deceleration drag when Space is held
                    if (keys.space && absSpeed > 0.3) {
                        const handbrakeBrake = CAR_MASS * 12.0 * delta;
                        const brakeDir = forwardSpeed > 0 ? -1 : 1;
                        carBody.applyImpulse({
                            x: forward.x * handbrakeBrake * brakeDir,
                            y: forward.y * handbrakeBrake * brakeDir,
                            z: forward.z * handbrakeBrake * brakeDir
                        }, true);
                    }

                    // 2. Acceleration / Braking / Fast Reverse (W & S)
                    let wantsW = keys.w;
                    let wantsS = keys.s;
                    let wantsShift = keys.shift;
                    let aiSteerFactor = 0.0;
                    let isAiDriven = false;

                    if (aiDriverActiveRef.current && carBody) {
                        isAiDriven = true;
                        const carPos = carBody.translation();
                        const carYaw = Math.atan2(forward.z, forward.x);

                        // 1. Dynamic Lookahead along Road Curve (Adapts in real-time to any seed)
                        const speedLookahead = THREE.MathUtils.clamp(forwardSpeed * 0.95, 12.0, 50.0);
                        const lookX = carPos.x + speedLookahead;
                        const roadAtLook = getProceduralRoadCurve(lookX, groundParamsRef.current.seed);

                        // Signed lateral offset from road centerline (normalized to 16m)
                        const lateralOffset = THREE.MathUtils.clamp((roadAtLook.z - carPos.z) / 16.0, -1.0, 1.0);
                        const roadTangent = Math.atan2(roadAtLook.dz, 1.0);
                        const tangentHeadingErr = roadTangent - carYaw;

                        // Target Beacon Heading in Car local frame
                        const tHeading = Math.atan2(localDz, Math.max(localDx, 2.0));

                        // 2. High-Speed Curve Curvature Anticipation
                        const nextRoad = getProceduralRoadCurve(lookX + 30.0, groundParamsRef.current.seed);
                        const roadCurvature = Math.abs(nextRoad.dz - roadAtLook.dz);

                        // 3. Precision Steering Authority (Centerline + Tangent + Target Guidance)
                        let targetSteering = tangentHeadingErr * 1.55 + lateralOffset * 0.55 + tHeading * 0.35;
                        if (onnxSession && aiActionOutput) {
                            const modelSteer = THREE.MathUtils.clamp(aiActionOutput[0], -1.0, 1.0);
                            targetSteering = THREE.MathUtils.lerp(targetSteering, modelSteer, 0.35);
                        }
                        aiSteerFactor = THREE.MathUtils.clamp(targetSteering, -1.0, 1.0);

                        // 4. Maximum Velocity & Tactical Nitro Boost Controller
                        // Straight stretches -> FULL NITRO BOOST (~360 km/h) to reach target in record time!
                        // Sharp mountain bends -> Controlled apex braking
                        const isStraight = (roadCurvature < 0.28) && (Math.abs(lateralOffset) < 0.35) && (Math.abs(tangentHeadingErr) < 0.22);
                        const isSharpCurve = (roadCurvature > 0.55) || (Math.abs(lateralOffset) > 0.65);

                        let targetThrottle = 1.0;
                        let targetShift = false;

                        if (isStraight && forwardSpeed > 18.0) {
                            targetThrottle = 1.0;
                            targetShift = true; // Tactical Nitro Boost on straights!
                        } else if (isSharpCurve && forwardSpeed > 30.0) {
                            targetThrottle = -0.45; // Smooth deceleration into sharp apex
                            targetShift = false;
                        } else {
                            targetThrottle = 1.0; // Full acceleration
                            targetShift = false;
                        }

                        // Guaranteed Forward Motion: NEVER STOP, NEVER REVERSE
                        if (forwardSpeed < 12.0) {
                            targetThrottle = 1.0;
                            targetShift = false;
                        }

                        const speedCap = targetShift ? BOOST_FORWARD_SPEED : NORMAL_FORWARD_SPEED;
                        const accelBase = targetShift ? BOOST_ACCEL_FORCE : NORMAL_ACCEL_FORCE;

                        if (targetThrottle > 0.0) {
                            if (forwardSpeed < speedCap) {
                                const force = accelBase * targetThrottle * delta;
                                carBody.applyImpulse({
                                    x: forward.x * force,
                                    y: forward.y * force,
                                    z: forward.z * force
                                }, true);
                            }
                        } else if (targetThrottle < 0.0) {
                            const brakeForce = BRAKE_FORCE * Math.abs(targetThrottle) * delta;
                            const effectiveBrake = Math.min(brakeForce, Math.max(forwardSpeed, 0.0) * CAR_MASS);
                            carBody.applyImpulse({
                                x: -forward.x * effectiveBrake,
                                y: -forward.y * effectiveBrake,
                                z: -forward.z * effectiveBrake
                            }, true);
                        }
                    }

                    if (!isAiDriven) {
                        const isBoosting = wantsShift && wantsW;
                        const targetMaxSpeed = isBoosting ? BOOST_FORWARD_SPEED : NORMAL_FORWARD_SPEED;
                        const currentAccel = isBoosting ? BOOST_ACCEL_FORCE : NORMAL_ACCEL_FORCE;

                        if (wantsW) {
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
                        } else if (wantsS) {
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
                    }

                    // 3. Realistic Speed-Sensitive Steering with Drift Counter-Steer Authority
                    const speedFactor = THREE.MathUtils.clamp(1.0 - (speedKmh / 110) * 0.78, 0.20, 1.0);
                    const normalMaxSteer = 0.30 * speedFactor;
                    const driftMaxSteer = 0.40; // ~23° counter-steer lock during drift
                    const maxSteerAngle = THREE.MathUtils.lerp(normalMaxSteer, driftMaxSteer, currentDriftFactor);

                    let targetSteer = 0;
                    if (aiDriverActiveRef.current) {
                        // Inverted sign to match Three.js coordinate system (A = +left, D = -right)
                        // Uses 0.40 rad max steer matching RL training environment
                        targetSteer = -aiSteerFactor * 0.40;
                    } else {
                        if (keys.a) targetSteer = maxSteerAngle;
                        if (keys.d) targetSteer = -maxSteerAngle;
                    }

                    const steerDampSpeed = aiDriverActiveRef.current ? 12.0 : ((targetSteer === 0) ? 14.0 : (currentDriftFactor > 0.3 ? 12.0 : 8.0));
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
                        const maxYawRate = aiDriverActiveRef.current ? 3.0 : THREE.MathUtils.damp(2.2, 1.0, 3.0, THREE.MathUtils.clamp(speedKmh / 90, 0, 1));
                        const kinematicYaw = (forwardSpeed / WHEELBASE) * Math.tan(currentSteerAngle);

                        if (currentDriftFactor > 0.05 && !aiDriverActiveRef.current) {
                            // Slip angle (radians)
                            const slipAngle = Math.atan2(lateralSpeed, Math.max(forwardSpeed, 0.5));
                            // Caster self-aligning stabilizing torque
                            const casterTorque = -slipAngle * 2.4;
                            // Driver direct counter-steer torque
                            const driverDriftTorque = currentSteerAngle * 4.2;
                            // Handbrake flick kick
                            const handbrakeKick = keys.space && Math.abs(currentSteerAngle) > 0.02 ? Math.sign(currentSteerAngle) * 1.1 : 0;

                            const dynamicDriftYaw = kinematicYaw * 0.35 + driverDriftTorque * 0.65 + casterTorque * 0.35 + handbrakeKick;
                            const blendedYaw = THREE.MathUtils.lerp(kinematicYaw, dynamicDriftYaw, currentDriftFactor);
                            targetYawRate = THREE.MathUtils.clamp(blendedYaw, -maxYawRate * 1.5, maxYawRate * 1.5);
                        } else {
                            targetYawRate = THREE.MathUtils.clamp(kinematicYaw, -maxYawRate, maxYawRate);
                        }
                    }
                    const yawDampRate = currentDriftFactor > 0.2 ? 10.0 : 8.0;
                    const newYaw = THREE.MathUtils.damp(currentYaw, targetYawRate, yawDampRate, delta);
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

                    // 5. Dynamic Camera FOV with smooth damping (Gentle 78° on Shift+W for high-speed sensation)
                    const isShiftBoosting = keys.shift && keys.w;
                    const targetFov = isShiftBoosting ? 78 : 75;
                    camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 1.4, delta);
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
                        } else if (isShiftBoosting) {
                            gearRef.current.innerText = 'NITRO 🔥';
                            gearRef.current.className = 'text-xs font-mono font-bold text-amber-400 animate-pulse';
                        } else {
                            gearRef.current.innerText = speedKmh > 55 ? 'GEAR 3' : speedKmh > 28 ? 'GEAR 2' : 'GEAR 1';
                            gearRef.current.className = 'text-xs font-mono font-bold text-emerald-400';
                        }
                    }

                    if (nitroBadgeRef.current) {
                        if (isShiftBoosting) {
                            nitroBadgeRef.current.innerText = '🔥 TURBO ACTIVE';
                            nitroBadgeRef.current.className = 'text-[11px] font-bold px-2 py-0.5 rounded-md font-mono bg-gradient-to-r from-amber-500 to-orange-500 text-black font-extrabold shadow-[0_0_15px_rgba(245,158,11,0.9)] animate-pulse';
                        } else if (keys.shift) {
                            nitroBadgeRef.current.innerText = '⚡ HOLD W TO BOOST';
                            nitroBadgeRef.current.className = 'text-[11px] font-bold px-2 py-0.5 rounded-md font-mono bg-cyan-500/20 text-cyan-300 border border-cyan-500/40';
                        } else {
                            nitroBadgeRef.current.innerText = 'HOLD SHIFT';
                            nitroBadgeRef.current.className = 'text-[11px] font-bold px-2 py-0.5 rounded-md font-mono text-neutral-400 bg-white/5';
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

                    const linvel = carBody.linvel();
                    const currentVel = new THREE.Vector3(linvel.x, linvel.y, linvel.z);
                    const carQuat = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
                    const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(carQuat);
                    const lateral = new THREE.Vector3(0, 0, 1).applyQuaternion(carQuat);
                    const forwardSpeed = currentVel.dot(forward);
                    const lateralSpeed = currentVel.dot(lateral);
                    const absSpeed = Math.abs(forwardSpeed);
                    const speedKmh = absSpeed * 3.6;
                    const isDrifting = currentDriftFactor > 0.18 && (Math.abs(lateralSpeed) > 0.5 || keys.space) && absSpeed > 1.8;

                    // Visual suspension weight transfer roll & pitch
                    const targetVisualRoll = THREE.MathUtils.clamp(-lateralSpeed * 0.014, -0.07, 0.07);
                    visualRollAngle = THREE.MathUtils.damp(visualRollAngle, targetVisualRoll, 10.0, delta);
                    if (Math.abs(visualRollAngle) > 0.001) {
                        const rollQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), visualRollAngle);
                        carScene.quaternion.multiply(rollQuat);
                    }

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
                    baseCamPos.add(carDelta);
                    currentLookTarget.add(carDelta);

                    // Safety net respawn: only if car falls through into the void
                    if (translation.y < -40.0) {
                        respawnCar();
                    }

                    // Update live GPS coordinates & Seeded Perlin Noise Radar
                    if (coordsRef.current) {
                        coordsRef.current.innerText = `X: ${translation.x.toFixed(1)} | Z: ${translation.z.toFixed(1)} | Y: ${translation.y.toFixed(1)}m`;
                    }

                    if (radarCanvasRef.current && groundParamsRef.current.showRadar) {
                        const heading = Math.atan2(forward.x, -forward.z);
                        drawPerlinNoiseRadar(radarCanvasRef.current, translation.x, translation.z, heading, groundParamsRef.current, 180);
                    }

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

                    if (cameraBadgeRef.current) {
                        if (cameraModeRef.current === 'free_orbit') {
                            cameraBadgeRef.current.innerText = 'FREE ORBIT [V]';
                            cameraBadgeRef.current.className = 'text-[10px] font-mono font-bold text-purple-400';
                        } else if (isDrivingState) {
                            if (currentCamDir > 0.1) {
                                cameraBadgeRef.current.innerText = 'REVERSE FRONT 🎥';
                                cameraBadgeRef.current.className = 'text-[10px] font-mono font-bold text-amber-400';
                            } else {
                                cameraBadgeRef.current.innerText = 'CHASE REAR 🎥';
                                cameraBadgeRef.current.className = 'text-[10px] font-mono font-bold text-cyan-400';
                            }
                        } else {
                            cameraBadgeRef.current.innerText = 'ORBIT READY 🔄';
                            cameraBadgeRef.current.className = 'text-[10px] font-mono font-bold text-emerald-400';
                        }
                    }

                    // Dynamic camera follow distance: exactly 20% further back on Shift + W with slow, smooth damping
                    const isShiftBoosting = keys.shift && keys.w;
                    const targetDist = isShiftBoosting ? userZoomDist * 1.20 : userZoomDist;
                    const targetHeight = isShiftBoosting ? 2.22 : 2.1;
                    currentFollowDist = THREE.MathUtils.damp(currentFollowDist, targetDist, 1.2, delta);
                    currentFollowHeight = THREE.MathUtils.damp(currentFollowHeight, targetHeight, 1.2, delta);

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
                        baseCamPos.copy(camera.position);
                    } else if (isDrivingState) {
                        controls.enabled = false;

                        // Framerate-independent camera position damping
                        baseCamPos.x = THREE.MathUtils.damp(baseCamPos.x, desiredCamPos.x, 10.0, delta);
                        baseCamPos.y = THREE.MathUtils.damp(baseCamPos.y, desiredCamPos.y, 10.0, delta);
                        baseCamPos.z = THREE.MathUtils.damp(baseCamPos.z, desiredCamPos.z, 10.0, delta);

                        const toCamNow = new THREE.Vector3().subVectors(baseCamPos, carCenter);
                        toCamNow.y = 0;
                        const currentDist = toCamNow.length();
                        const maxAllowedDist = currentFollowDist * 1.06;
                        if (currentDist > maxAllowedDist && currentDist > 0.01) {
                            toCamNow.normalize().multiplyScalar(maxAllowedDist);
                            baseCamPos.x = carCenter.x + toCamNow.x;
                            baseCamPos.z = carCenter.z + toCamNow.z;
                        }

                        // Framerate-independent look target damping
                        currentLookTarget.x = THREE.MathUtils.damp(currentLookTarget.x, carTargetLook.x, 14.0, delta);
                        currentLookTarget.y = THREE.MathUtils.damp(currentLookTarget.y, carTargetLook.y, 14.0, delta);
                        currentLookTarget.z = THREE.MathUtils.damp(currentLookTarget.z, carTargetLook.z, 14.0, delta);

                        controls.target.copy(carCenter);

                    } else {
                        controls.enabled = true;
                        controls.target.copy(carCenter);

                        if (userHasManuallyOrbited) {
                            controls.update();
                            baseCamPos.copy(camera.position);
                            currentLookTarget.copy(controls.target);
                        } else {
                            // Framerate-independent smooth settle damping when coming to rest
                            baseCamPos.x = THREE.MathUtils.damp(baseCamPos.x, desiredCamPos.x, 6.0, delta);
                            baseCamPos.y = THREE.MathUtils.damp(baseCamPos.y, desiredCamPos.y, 6.0, delta);
                            baseCamPos.z = THREE.MathUtils.damp(baseCamPos.z, desiredCamPos.z, 6.0, delta);

                            currentLookTarget.x = THREE.MathUtils.damp(currentLookTarget.x, carTargetLook.x, 8.0, delta);
                            currentLookTarget.y = THREE.MathUtils.damp(currentLookTarget.y, carTargetLook.y, 8.0, delta);
                            currentLookTarget.z = THREE.MathUtils.damp(currentLookTarget.z, carTargetLook.z, 8.0, delta);

                            if (baseCamPos.distanceTo(desiredCamPos) < 0.04 && currentLookTarget.distanceTo(carCenter) < 0.04) {
                                controls.update();
                                baseCamPos.copy(camera.position);
                            }
                        }
                    }

                    // Screen Shake (Triggered ONLY by active Shift + W Turbo Boost)
                    const shakeMultiplier = drivingDynamicsRef.current?.shakeIntensity ?? 1.0;
                    const shakeEnabled = drivingDynamicsRef.current?.screenShake ?? true;

                    let targetShake = 0.0;
                    if (isShiftBoosting && shakeEnabled) {
                        targetShake = 0.048;
                    }
                    if (isDrifting && speedKmh > 35.0 && shakeEnabled) {
                        targetShake = Math.max(targetShake, 0.018);
                    }

                    currentShakeIntensity = THREE.MathUtils.damp(currentShakeIntensity, targetShake, 10.0, delta);
                    screenShakePunch = THREE.MathUtils.damp(screenShakePunch, 0.0, 12.0, delta);

                    const totalShake = (currentShakeIntensity + screenShakePunch) * shakeMultiplier;

                    camera.position.copy(baseCamPos);

                    if (totalShake > 0.0005) {
                        shakeTime += delta * 48.0;
                        const sx = (Math.sin(shakeTime * 1.0) * 0.7 + Math.sin(shakeTime * 2.37) * 0.3) * totalShake;
                        const sy = (Math.cos(shakeTime * 1.41) * 0.6 + Math.sin(shakeTime * 3.19) * 0.4) * totalShake * 0.75;

                        const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
                        const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);

                        camera.position.addScaledVector(camRight, sx);
                        camera.position.addScaledVector(camUp, sy);

                        const lookShaken = new THREE.Vector3(
                            currentLookTarget.x + sx * 0.25,
                            currentLookTarget.y + sy * 0.25,
                            currentLookTarget.z
                        );
                        camera.lookAt(lookShaken);

                        const shakeRoll = Math.sin(shakeTime * 1.15) * totalShake * 0.04;
                        camera.rotation.z += shakeRoll;
                    } else {
                        camera.lookAt(currentLookTarget);
                    }

                    // Background Blur on Shift + W Boost (Slow, gradual approach)
                    const speedBlurEnabled = drivingDynamicsRef.current?.speedBlur ?? true;
                    const targetBlurFactor = (isShiftBoosting && speedBlurEnabled) 
                        ? Math.min(0.70, 0.35 + (speedKmh / 100) * 0.35) 
                        : 0.0;
                    currentSpeedBlur = THREE.MathUtils.damp(currentSpeedBlur, targetBlurFactor, 1.8, delta);

                    if (speedBlurRef.current) {
                        if (currentSpeedBlur > 0.01) {
                            const blurPx = Math.round(currentSpeedBlur * 8);
                            speedBlurRef.current.style.opacity = currentSpeedBlur.toFixed(3);
                            speedBlurRef.current.style.backdropFilter = `blur(${blurPx}px)`;
                            speedBlurRef.current.style.webkitBackdropFilter = `blur(${blurPx}px)`;
                            speedBlurRef.current.style.display = 'block';
                        } else {
                            speedBlurRef.current.style.opacity = '0';
                            speedBlurRef.current.style.backdropFilter = 'none';
                            speedBlurRef.current.style.webkitBackdropFilter = 'none';
                        }
                    }
                }

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
            window.removeEventListener('wheel', handleWheel);
            window.removeEventListener('car:new-target', handleNewTarget);
            rebuildWheelCollidersRef.current = null;
            carSceneRef.current = null;

            if (targetBeacon) {
                targetBeacon.dispose();
            }

            if (lidarLines) {
                scene.remove(lidarLines);
                lidarGeometry.dispose();
                lidarMaterial.dispose();
            }

            if (ground) {
                ground.dispose();
                ground = null;
                groundRef.current = null;
            }

            if (road) {
                road.dispose();
                road = null;
                roadRef.current = null;
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

            {/* Speed Blur Overlay */}
            <div
                ref={speedBlurRef}
                className="pointer-events-none fixed inset-0 opacity-0 transition-opacity duration-300"
                style={{ background: 'radial-gradient(circle at center, transparent 40%, rgba(0,0,0,0.6) 100%)' }}
            />

            {/* Top-Left Telemetry & Autonomous Navigation Mode HUD */}
            <div className="absolute top-6 left-6 z-10 pointer-events-none flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <div
                        ref={aiBadgeRef}
                        className={`px-3.5 py-1.5 rounded-full text-xs font-mono font-bold tracking-wider backdrop-blur-md border shadow-lg ${
                            aiDriverActive
                                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.35)] animate-pulse'
                                : 'bg-neutral-900/80 text-neutral-400 border-white/10'
                        }`}
                    >
                        {aiDriverActive ? '🤖 AI AUTONOMOUS PILOT: ENGAGED' : '🏎️ MANUAL CONTROL [KEY T: ENGAGE AI]'}
                    </div>
                    <div
                        ref={targetBadgeRef}
                        className="px-3.5 py-1.5 rounded-full text-xs font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 backdrop-blur-md shadow-lg"
                    >
                        🎯 WAYPOINT: {Math.round(targetDistRef.current)}m
                    </div>
                </div>
            </div>

            {/* Bottom-Left Dashboard Gauge */}
            <div className="absolute bottom-6 left-6 z-10 pointer-events-none flex items-end gap-4">
                <div className="px-5 py-3 rounded-2xl bg-neutral-900/85 backdrop-blur-md border border-white/15 shadow-2xl flex flex-col min-w-[140px]">
                    <div className="flex items-baseline gap-2">
                        <span ref={speedRef} className="text-4xl font-mono font-black text-white tracking-tight">0</span>
                        <span className="text-xs font-mono font-bold text-neutral-400 uppercase">KM/H</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3">
                        <span ref={gearRef} className="text-xs font-mono font-bold text-emerald-400">NEUTRAL</span>
                        <span ref={nitroBadgeRef} className="text-[10px] font-bold px-2 py-0.5 rounded-md font-mono text-neutral-400 bg-white/5">HOLD SHIFT</span>
                    </div>
                </div>
            </div>

            {/* Bottom-Right Seeded Perlin Noise Radar Mini-Map */}
            {groundParams.showRadar && (
                <div className="absolute bottom-6 right-6 pointer-events-none z-10 flex flex-col items-end gap-1">
                    <div className="relative p-1.5 rounded-2xl bg-neutral-900/85 backdrop-blur-md border border-white/15 shadow-2xl flex flex-col items-center">
                        <canvas
                            ref={radarCanvasRef}
                            width={110}
                            height={110}
                            className="w-[110px] h-[110px] mt-1 rounded-full shadow-inner"
                        />
                        <div ref={coordsRef} className="mt-1 text-[9px] font-mono text-neutral-400">
                            X: 0.0 | Z: 0.0 | Y: 0.0m
                        </div>
                    </div>
                </div>
            )}

            {/* Leva GUI Control Panel Config */}
            <Leva
                titleBar={{ title: 'Autonomous Car & Mountain Highway' }}
                collapsed={true}
                oneLineLabels={false}
            />
        </div>
    );
}

export default ThreeScene;
