import * as THREE from 'three';
import { useEffect, useRef, useState } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import RAPIER from '@dimforge/rapier3d-compat';

function ThreeScene() {
    const mountRef = useRef(null);
    const speedRef = useRef(null);
    const gearRef = useRef(null);
    const nitroBadgeRef = useRef(null);
    const cameraBadgeRef = useRef(null);
    const [debugVisible, setDebugVisible] = useState(true);
    const debugVisibleRef = useRef(true);
    const [cameraMode, setCameraMode] = useState('auto'); // 'auto' | 'free_orbit'
    const cameraModeRef = useRef('auto');

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
        const clock = new THREE.Clock();

        // Driving Tuning Parameters
        const CAR_MASS = 1500;                     // 1500 kg Real Car Mass
        const WHEEL_MASS = 25;                     // 25 kg per wheel
        const NORMAL_FORWARD_SPEED = 24;           // ~86 km/h normal cruising top speed
        const BOOST_FORWARD_SPEED = 42;            // ~151 km/h Turbo Nitro top speed
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

        // 2. Camera (Starts directly behind car looking forward - GTA 3rd person)
        const camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        camera.position.set(-6.5, 2.6, 0);
        const currentLookTarget = new THREE.Vector3(3.5, 1.2, 0);
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
        controls.enablePan = false; // Keep orbit centered strictly on the car
        controls.target.set(0, 0.85, 0);
        controls.maxPolarAngle = Math.PI / 2 - 0.05; // Never dip below ground level
        controls.minPolarAngle = 0.08;
        controls.minDistance = 2.0;
        controls.maxDistance = 35.0;
        controls.enabled = true;

        const onOrbitStart = () => {
            userHasManuallyOrbited = true;
        };
        controls.addEventListener('start', onOrbitStart);

        // 5. Solid Ground Mesh (Expansive 2000m x 2000m driving arena)
        const groundWidth = 2000;
        const groundThickness = 1;
        const groundDepth = 2000;

        const groundGeometry = new THREE.BoxGeometry(groundWidth, groundThickness, groundDepth);
        const groundMaterial = new THREE.MeshStandardMaterial({
            color: 0x1f2227,
            roughness: 0.85,
            metalness: 0.1
        });
        const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
        groundMesh.position.y = -groundThickness / 2; // Top surface at Y = 0.0
        groundMesh.receiveShadow = true;
        scene.add(groundMesh);

        // Visual Grid (placed at 1mm so it doesn't slice through tyres, spaced every 5m)
        const grid = new THREE.GridHelper(groundWidth, 400, 0x00ff88, 0x3a3f47);
        grid.position.y = 0.001;
        scene.add(grid);

        // 6. Lighting with Dynamic Car-Proximity Shadow Mapping
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 2.5);
        const sunOffset = new THREE.Vector3(25, 38, 20);
        directionalLight.position.copy(sunOffset);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.near = 1.0;
        directionalLight.shadow.camera.far = 110.0;

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
        debugLines.renderOrder = 999; // Render on top of solid models
        scene.add(debugLines);

        // 8. Keyboard Controls State
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
            if ((k === 'r' || code === 'KeyR') && carBody) {
                carBody.setTranslation({ x: 0, y: 0.15, z: 0 }, true);
                carBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
                carBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
                carBody.setAngvel({ x: 0, y: 0, z: 0 }, true);

                prevCarCenter = new THREE.Vector3(0, 1.0, 0);
                isDrivingState = false;
                currentCamDir = -1.0;
                currentFollowDist = 7.0;
                currentFollowHeight = 2.1;
                userHasManuallyOrbited = false;
                camera.position.set(-6.8, 2.4, 0);
                currentLookTarget.set(0, 1.0, 0);
                camera.lookAt(currentLookTarget);
                controls.target.set(0, 0.85, 0);
                controls.update();
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

        // 9. Asynchronously Initialize Rapier WASM & Create Physics World
        async function initPhysics() {
            try {
                // Await WASM initialization
                await RAPIER.init();
                if (!isMounted) return;

                // Realistic Stronger Gravity (Negative pulls DOWNWARDS)
                const gravity = { x: 0.0, y: -18.0, z: 0.0 };
                world = new RAPIER.World(gravity);

                // Increase Solver Iterations for crisp, solid collisions (No squishing/sticking)
                world.integrationParameters.numSolverIterations = 8;

                // Static Ground Collider
                const groundBodyDesc = RAPIER.RigidBodyDesc.fixed();
                const groundBody = world.createRigidBody(groundBodyDesc);
                const groundColliderDesc = RAPIER.ColliderDesc.cuboid(
                    groundWidth / 2,
                    groundThickness / 2,
                    groundDepth / 2
                )
                    .setTranslation(0, -groundThickness / 2, 0)
                    .setRestitution(0.0)
                    .setFriction(0.8);
                world.createCollider(groundColliderDesc, groundBody);

                // Dynamic Car RigidBody with CCD (Continuous Collision Detection prevents tunneling/sticking)
                // Spawns smoothly right on the ground surface
                const carBodyDesc = RAPIER.RigidBodyDesc.dynamic()
                    .setTranslation(0, 0.15, 0)
                    .setLinearDamping(0.04)
                    .setAngularDamping(2.0)
                    .setCcdEnabled(true);
                carBody = world.createRigidBody(carBodyDesc);

                // Lock pitch (Z) and roll (X) so the car NEVER tilts into the ground or flips over (True GTA arcade feel!)
                carBody.setEnabledRotations(false, true, false, true);

                // Chassis Collider (Full 100% coverage: bumpers, hood, roof & doors)
                // Half-extents: length=2.20, height=0.48, width=0.85 centered at (0.22, 0.65, 0)
                const chassisColliderDesc = RAPIER.ColliderDesc.cuboid(2.20, 0.48, 0.85)
                    .setTranslation(0.22, 0.65, 0)
                    .setRestitution(0.35)
                    .setMass(CAR_MASS)
                    .setFriction(0.1);
                world.createCollider(chassisColliderDesc, carBody);

                // Four Wheel Colliders (0.0 rolling friction allows smooth rolling without drag; lateral grip handled in code)
                const wheelOffsets = [
                    { name: 'Wheel_BL', x: -1.037, y: 0.232, z: -0.703 },
                    { name: 'Wheel_BR', x: -1.037, y: 0.232, z:  0.700 },
                    { name: 'Wheel_FL', x:  1.515, y: 0.232, z: -0.694 },
                    { name: 'Wheel_FR', x:  1.515, y: 0.232, z:  0.700 }
                ];

                wheelOffsets.forEach(w => {
                    const wheelColliderDesc = RAPIER.ColliderDesc.ball(WHEEL_RADIUS)
                        .setTranslation(w.x, w.y, w.z)
                        .setMass(WHEEL_MASS)
                        .setFriction(0.0)
                        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
                        .setRestitution(0.0);
                    world.createCollider(wheelColliderDesc, carBody);
                });

                // Obstacle Generator Helper (Lightweight, knockable dynamic blocks)
                function addObstacle(x, z, width = 1.5, height = 1.5, depth = 1.5, mass = 15, color = 0xd97736, yOffset = null) {
                    const y = yOffset !== null ? yOffset : height / 2;

                    // 1. Visual Box Mesh
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

                    // 2. Rapier Dynamic Body with CCD (Ultra-lightweight: 15-20 kg)
                    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
                        .setTranslation(x, y, z)
                        .setLinearDamping(0.3)
                        .setAngularDamping(0.5)
                        .setCcdEnabled(true);
                    const body = world.createRigidBody(bodyDesc);

                    const colliderDesc = RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2)
                        .setFriction(0.2)
                        .setRestitution(0.45) // Bouncy knockback on impact!
                        .setMass(mass);       // Ultra-lightweight so car smashes them away easily
                    world.createCollider(colliderDesc, body);

                    dynamicObstacles.push({ mesh, body });
                }

                // Stack of lightweight wooden crates directly ahead of the car to smash!
                // Ground row (ahead at X = 9)
                addObstacle(9, -1.6, 1.4, 1.4, 1.4, 15, 0xd97736);
                addObstacle(9,  0.0, 1.4, 1.4, 1.4, 15, 0xc26227);
                addObstacle(9,  1.6, 1.4, 1.4, 1.4, 15, 0xd97736);
                // Stacked top row (Pyramid crate stack)
                addObstacle(9, -0.8, 1.4, 1.4, 1.4, 12, 0xe08b4c, 2.1);
                addObstacle(9,  0.8, 1.4, 1.4, 1.4, 12, 0xe08b4c, 2.1);

                // More scatter crates around the arena
                addObstacle(14,  -5, 1.5, 1.5, 1.5, 15, 0x8a5d3b);
                addObstacle(14,   5, 1.5, 1.5, 1.5, 15, 0x8a5d3b);
                addObstacle(-8,  -6, 1.5, 1.5, 1.5, 15, 0x5a6375);
                addObstacle(-8,   6, 1.5, 1.5, 1.5, 15, 0x5a6375);

                // Load 3D Car GLB Model
                const loader = new GLTFLoader();
                loader.load(
                    '/car.glb',
                    (gltf) => {
                        if (!isMounted) return;
                        carScene = gltf.scene;

                        // Spawn visually at initial physics body position
                        carScene.position.set(0, 5, 0);

                        // Shadows
                        carScene.traverse((child) => {
                            if (child.isMesh) {
                                child.castShadow = true;
                                child.receiveShadow = true;
                            }
                        });

                        // Grab steering nodes
                        steerFL = carScene.getObjectByName('Steer_FL');
                        steerFR = carScene.getObjectByName('Steer_FR');

                        // Grab wheel meshes for spinning
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

        // 10. Animation & Driving Loop
        function animate() {
            if (!isMounted) return;
            animationId = requestAnimationFrame(animate);

            const delta = Math.min(clock.getDelta(), 0.05);

            if (world) {
                // WASD Driving Controls & Forces
                if (carBody) {
                    const rot = carBody.rotation();
                    const carQuat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);

                    // Car local axes (+X is forward, +Z is right)
                    const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(carQuat);
                    const lateral = new THREE.Vector3(0, 0, 1).applyQuaternion(carQuat);

                    const linvel = carBody.linvel();
                    const currentVel = new THREE.Vector3(linvel.x, 0, linvel.z);

                    // Calculate speed along forward and sideways directions
                    const forwardSpeed = currentVel.dot(forward);
                    const lateralSpeed = currentVel.dot(lateral);
                    const absSpeed = Math.abs(forwardSpeed);

                    // 1. Progressive Lateral Tyre Grip (Holds road, prevents ice-sliding)
                    if (Math.abs(lateralSpeed) > 0.01) {
                        const gripImpulse = -lateralSpeed * CAR_MASS * Math.min(10.0 * delta, 0.85);
                        carBody.applyImpulse({
                            x: lateral.x * gripImpulse,
                            y: 0,
                            z: lateral.z * gripImpulse
                        }, true);
                    }

                    // 2. Acceleration / Braking / Fast Reverse (W & S)
                    // Turbo Nitro Boost is active when holding Shift + W
                    const isBoosting = keys.shift && keys.w;
                    const targetMaxSpeed = isBoosting ? BOOST_FORWARD_SPEED : NORMAL_FORWARD_SPEED;
                    const currentAccel = isBoosting ? BOOST_ACCEL_FORCE : NORMAL_ACCEL_FORCE;

                    if (keys.w) {
                        // If rolling backwards, apply brake first to instantly reverse direction
                        if (forwardSpeed < -0.1) {
                            const brakeForce = BRAKE_FORCE * 1.5 * delta;
                            carBody.applyImpulse({
                                x: forward.x * brakeForce,
                                y: 0,
                                z: forward.z * brakeForce
                            }, true);
                        } else if (forwardSpeed < targetMaxSpeed) {
                            const force = currentAccel * delta;
                            carBody.applyImpulse({
                                x: forward.x * force,
                                y: 0,
                                z: forward.z * force
                            }, true);
                        }
                    } else if (keys.s) {
                        if (forwardSpeed > 0.1) {
                            // Active powerful brakes if car is rolling forward
                            const brake = Math.min(BRAKE_FORCE * delta, forwardSpeed * CAR_MASS * 0.95);
                            carBody.applyImpulse({
                                x: -forward.x * brake,
                                y: 0,
                                z: -forward.z * brake
                            }, true);
                        } else if (forwardSpeed > -MAX_REVERSE_SPEED) {
                            // Fast, punchy reverse gear
                            const force = REVERSE_FORCE * delta;
                            carBody.applyImpulse({
                                x: -forward.x * force,
                                y: 0,
                                z: -forward.z * force
                            }, true);
                        }
                    } else {
                        // Natural gentle coasting / rolling resistance when no pedal pressed
                        if (absSpeed > 0.05) {
                            const decel = Math.min(COAST_DECEL * delta, absSpeed * CAR_MASS * 0.5);
                            const decelDir = forwardSpeed > 0 ? -1 : 1;
                            carBody.applyImpulse({
                                x: forward.x * decel * decelDir,
                                y: 0,
                                z: forward.z * decel * decelDir
                            }, true);
                        } else {
                            // Smoothly settle car to rest when nearly stopped (< 0.18 km/h) to prevent micro-drift
                            const currentLinvel = carBody.linvel();
                            carBody.setLinvel({ x: 0, y: currentLinvel.y, z: 0 }, true);
                        }
                    }

                    // 3. Realistic Speed-Sensitive Ackermann Steering (Smooth, stable & controllable)
                    const speedKmh = absSpeed * 3.6;

                    // Speed-sensitive steering factor (nimble at slow speeds, calm & stable at high speeds)
                    const speedFactor = THREE.MathUtils.clamp(1.0 - (speedKmh / 110) * 0.78, 0.20, 1.0);
                    const maxSteerAngle = 0.30 * speedFactor; // ~21.7° at low speed, down to ~4.3° at Nitro speed

                    let targetSteer = 0;
                    if (keys.a) targetSteer = maxSteerAngle;
                    if (keys.d) targetSteer = -maxSteerAngle;

                    // Smooth progressive steering wheel turn (0.08 turn-in prevents twitching, 0.18 auto-centers)
                    const steerLerpSpeed = (targetSteer === 0) ? 0.18 : 0.08;
                    currentSteerAngle = THREE.MathUtils.lerp(currentSteerAngle, targetSteer, steerLerpSpeed);

                    if (steerFL) steerFL.rotation.y = currentSteerAngle;
                    if (steerFR) steerFR.rotation.y = currentSteerAngle;

                    // Physics Ackermann turning: Yaw Rate omega = (v / L) * tan(delta)
                    if (absSpeed > 0.15) {
                        // Max yaw rate cap prevents sudden snap-oversteer or spinouts at high speed
                        const maxYawRate = THREE.MathUtils.lerp(2.2, 1.0, THREE.MathUtils.clamp(speedKmh / 90, 0, 1));
                        let targetYawRate = (forwardSpeed / WHEELBASE) * Math.tan(currentSteerAngle);
                        targetYawRate = THREE.MathUtils.clamp(targetYawRate, -maxYawRate, maxYawRate);

                        const currentAngvel = carBody.angvel();
                        const newYaw = THREE.MathUtils.lerp(currentAngvel.y, targetYawRate, 0.14);
                        carBody.setAngvel({ x: 0, y: newYaw, z: 0 }, true);
                    } else {
                        // Stationary: Car does NOT spin in place
                        carBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
                    }

                    // 4. Physically Accurate Wheel Spin (Roll angle matched to exact distance moved)
                    const rollDelta = (forwardSpeed * delta) / WHEEL_RADIUS;
                    wheels.forEach(wheel => {
                        wheel.rotateX(rollDelta);
                    });

                    // 5. Dynamic Camera FOV for speed thrill & high-speed camera feedback
                    const targetFov = isBoosting ? 80 : 75;
                    if (Math.abs(camera.fov - targetFov) > 0.05) {
                        camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 1.0 - Math.exp(-3.5 * delta));
                        camera.updateProjectionMatrix();
                    }

                    // Live HUD Speedometer & Nitro updates (Zero React re-render overhead)
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

                // Step physics simulation
                world.step();

                // Synchronize visual car with physics & dynamic camera system
                if (carScene && carBody) {
                    const translation = carBody.translation();
                    const rotation = carBody.rotation();
                    carScene.position.set(translation.x, translation.y, translation.z);
                    carScene.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

                    const carCenter = new THREE.Vector3(translation.x, translation.y + 0.85, translation.z);

                    // Dynamic Shadow Follow: Keep high-res shadow projection centered on car/camera proximity (like AAA games)
                    directionalLight.target.position.copy(carCenter);
                    directionalLight.position.copy(carCenter).add(sunOffset);
                    directionalLight.target.updateMatrixWorld();

                    // 1. Rigidly translate camera and look-target by car displacement so camera NEVER falls behind!
                    if (!prevCarCenter) {
                        prevCarCenter = carCenter.clone();
                    }
                    const carDelta = new THREE.Vector3().subVectors(carCenter, prevCarCenter);
                    prevCarCenter.copy(carCenter);
                    camera.position.add(carDelta);
                    currentLookTarget.add(carDelta);

                    // Safety net: Auto-respawn car if it somehow drops below ground level
                    if (carBody.translation().y < -2.0) {
                        carBody.setTranslation({ x: 0, y: 0.15, z: 0 }, true);
                        carBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
                        carBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
                        carBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
                    }

                    // Car forward orientation (+X is forward)
                    const carQuat = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
                    const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(carQuat);

                    // Determine if car is driving vs stationary/not moving
                    const linvel = carBody.linvel();
                    const currentVel = new THREE.Vector3(linvel.x, 0, linvel.z);
                    const forwardSpeed = currentVel.dot(forward);
                    const currentSpeed = currentVel.length();

                    // Only actual driving throttles (W or S) or moving speed activate driving camera!
                    // Pressing A and D alone when stationary NEVER triggers driving mode, so camera stays 100% still!
                    const isThrottleActive = keys.w || keys.s;
                    const isActuallyMoving = currentSpeed > 0.35;

                    if ((isThrottleActive && currentSpeed > 0.15) || isActuallyMoving) {
                        isDrivingState = true;
                        userHasManuallyOrbited = false;
                    } else if (!isThrottleActive && currentSpeed < 0.10) {
                        isDrivingState = false;
                    }

                    // Forward vs Reverse camera mode:
                    // When moving backward with S: camera moves in front of the car facing it!
                    // When driving forward: camera stays behind the car facing it!
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

                    // Smooth transition between behind (-1.0) and in front (+1.0)
                    currentCamDir = THREE.MathUtils.lerp(currentCamDir, targetCamDir, 1.0 - Math.exp(-6.0 * delta));

                    const isBoosting = keys.shift && keys.w;

                    // Update live camera badge in HUD
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

                    // Follow distance & height: smoothly interpolate so Nitro boost never jerks camera backwards
                    const targetDist = isBoosting ? 8.2 : 7.0;
                    const targetHeight = isBoosting ? 2.3 : 2.1;
                    const zoomLerpSpeed = 1.0 - Math.exp(-2.5 * delta);
                    currentFollowDist = THREE.MathUtils.lerp(currentFollowDist, targetDist, zoomLerpSpeed);
                    currentFollowHeight = THREE.MathUtils.lerp(currentFollowHeight, targetHeight, zoomLerpSpeed);

                    // Compute smooth camera position:
                    // In forward: directly behind the car (-forward * currentFollowDist)
                    // In reverse: directly in front of the car (+forward * currentFollowDist)
                    // During transition: curves smoothly around the side of the car
                    const lateral = new THREE.Vector3(-forward.z, 0, forward.x);
                    const arcSide = (1.0 - currentCamDir * currentCamDir) * (currentFollowDist * 0.7);

                    const desiredCamPos = new THREE.Vector3()
                        .copy(carCenter)
                        .addScaledVector(forward, currentCamDir * currentFollowDist)
                        .addScaledVector(lateral, arcSide);
                    desiredCamPos.y = carCenter.y + (currentFollowHeight - 0.85);
                    if (desiredCamPos.y < 1.15) desiredCamPos.y = 1.15;

                    // The camera ALWAYS looks directly at the car (rock solid center of screen)
                    const carTargetLook = new THREE.Vector3(carCenter.x, carCenter.y + 0.55, carCenter.z);

                    if (cameraModeRef.current === 'free_orbit') {
                        // User chose free orbit mode (camera still follows vehicle translation)
                        controls.enabled = true;
                        controls.target.copy(carCenter);
                        controls.update();
                        currentLookTarget.copy(controls.target);
                    } else if (isDrivingState) {
                        // Driving: Follow camera takes over smoothly
                        controls.enabled = false;

                        // Follow spring: smooth and locked to the car's motion
                        const followSpeed = 1.0 - Math.exp(-12.0 * delta);
                        camera.position.lerp(desiredCamPos, followSpeed);

                        // Strict distance clamp: guarantee camera keeps up with Nitro speed smoothly
                        const toCamNow = new THREE.Vector3().subVectors(camera.position, carCenter);
                        toCamNow.y = 0;
                        const currentDist = toCamNow.length();
                        const maxAllowedDist = currentFollowDist * 1.06;
                        if (currentDist > maxAllowedDist && currentDist > 0.01) {
                            toCamNow.normalize().multiplyScalar(maxAllowedDist);
                            camera.position.x = carCenter.x + toCamNow.x;
                            camera.position.z = carCenter.z + toCamNow.z;
                        }

                        // Look directly at the car (faces the car always, no wild steering pans)
                        currentLookTarget.lerp(carTargetLook, 1.0 - Math.exp(-14.0 * delta));
                        camera.lookAt(currentLookTarget);

                        controls.target.copy(carCenter);

                    } else {
                        // Stopped / stationary state
                        controls.enabled = true;
                        controls.target.copy(carCenter);

                        if (userHasManuallyOrbited) {
                            controls.update();
                            currentLookTarget.copy(controls.target);
                        } else {
                            // Settle camera to rest position when stopped
                            const settleLerp = 1.0 - Math.exp(-6.0 * delta);
                            camera.position.lerp(desiredCamPos, settleLerp);
                            currentLookTarget.lerp(carTargetLook, settleLerp);
                            camera.lookAt(currentLookTarget);

                            if (camera.position.distanceTo(desiredCamPos) < 0.04 && currentLookTarget.distanceTo(carCenter) < 0.04) {
                                controls.update();
                            }
                        }
                    }
                }

                // Synchronize dynamic obstacles (crates) with physics
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

        // 11. Resize Handler
        function handleResize() {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        }

        window.addEventListener('resize', handleResize);

        // 12. Safe Cleanup
        return () => {
            isMounted = false;
            cancelAnimationFrame(animationId);
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', handleBlur);

            groundGeometry.dispose();
            groundMaterial.dispose();
            grid.dispose();
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
            <div ref={mountRef} className="w-full h-full" />
        </div>
    );
}

export default ThreeScene;
