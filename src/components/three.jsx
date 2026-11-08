import * as THREE from 'three';
import { useEffect, useRef, useState } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import RAPIER from '@dimforge/rapier3d-compat';

// Mathematical height function for the irregular ground
function getTerrainHeight(x, z) {
    const px = x;
    const py = -z;
    return (
        Math.sin(px * 0.05) * 3 +
        Math.cos(py * 0.08) * 4 +
        Math.sin((px + py) * 0.03) * 5
    );
}

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

        const initialSpawnY = getTerrainHeight(0, 0) + 0.45;
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
        scene.fog = new THREE.Fog(0x181a1f, 90, 190);

        // 2. Camera (Starts directly behind car looking forward - GTA 3rd person)
        const camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        camera.position.set(-6.5, initialSpawnY + 2.4, 0);
        const currentLookTarget = new THREE.Vector3(3.5, initialSpawnY + 1.2, 0);
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
        controls.target.set(0, initialSpawnY + 0.85, 0);
        controls.maxPolarAngle = Math.PI / 2 - 0.05; // Never dip below ground level
        controls.minPolarAngle = 0.08;
        controls.minDistance = 2.0;
        controls.maxDistance = 35.0;
        controls.enabled = true;

        const onOrbitStart = () => {
            userHasManuallyOrbited = true;
        };
        controls.addEventListener('start', onOrbitStart);

        // 5. Irregular Ground (Faceted Low-Poly Terrain)
        const geometry = new THREE.PlaneGeometry(
            200, 200,
            100, 100
        );

        const positions = geometry.attributes.position;

        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const y = positions.getY(i);

            const height =
                Math.sin(x * 0.05) * 3 +
                Math.cos(y * 0.08) * 4 +
                Math.sin((x + y) * 0.03) * 5;

            positions.setZ(i, height);
        }

        geometry.computeVertexNormals();

        const material = new THREE.MeshStandardMaterial({
            color: 0x668844,
            flatShading: true,
            roughness: 0.85,
            metalness: 0.1
        });

        const terrain = new THREE.Mesh(geometry, material);
        terrain.rotation.x = -Math.PI / 2;
        terrain.receiveShadow = true;
        scene.add(terrain);

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
                const resetY = getTerrainHeight(0, 0) + 0.45;
                carBody.setTranslation({ x: 0, y: resetY, z: 0 }, true);
                carBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
                carBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
                carBody.setAngvel({ x: 0, y: 0, z: 0 }, true);

                prevCarCenter = new THREE.Vector3(0, resetY + 0.85, 0);
                isDrivingState = false;
                currentCamDir = -1.0;
                currentFollowDist = 7.0;
                currentFollowHeight = 2.1;
                userHasManuallyOrbited = false;
                camera.position.set(-6.8, resetY + 2.4, 0);
                currentLookTarget.set(0, resetY + 1.0, 0);
                camera.lookAt(currentLookTarget);
                controls.target.set(0, resetY + 0.85, 0);
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

                // Strong Realistic Gravity
                const gravity = { x: 0.0, y: -20.0, z: 0.0 };
                world = new RAPIER.World(gravity);

                // Increase Solver Iterations for solid, crisp collisions
                world.integrationParameters.numSolverIterations = 8;

                // Static Ground Collider (Trimesh matching the irregular terrain)
                const groundBodyDesc = RAPIER.RigidBodyDesc.fixed()
                    .setRotation({
                        x: terrain.quaternion.x,
                        y: terrain.quaternion.y,
                        z: terrain.quaternion.z,
                        w: terrain.quaternion.w
                    });
                const groundBody = world.createRigidBody(groundBodyDesc);

                const vertices = Float32Array.from(geometry.attributes.position.array);
                const indices = Uint32Array.from(geometry.index.array);

                const groundColliderDesc = RAPIER.ColliderDesc.trimesh(vertices, indices)
                    .setRestitution(0.0)
                    .setFriction(0.85);
                world.createCollider(groundColliderDesc, groundBody);

                // Boundary walls around perimeter (200m x 200m) to keep the car inside
                const wallBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
                world.createCollider(RAPIER.ColliderDesc.cuboid(100, 35, 2).setTranslation(0, 0, 100), wallBody);
                world.createCollider(RAPIER.ColliderDesc.cuboid(100, 35, 2).setTranslation(0, 0, -100), wallBody);
                world.createCollider(RAPIER.ColliderDesc.cuboid(2, 35, 100).setTranslation(100, 0, 0), wallBody);
                world.createCollider(RAPIER.ColliderDesc.cuboid(2, 35, 100).setTranslation(-100, 0, 0), wallBody);

                // Dynamic Car RigidBody with CCD
                // Spawns smoothly right on the terrain surface
                const carBodyDesc = RAPIER.RigidBodyDesc.dynamic()
                    .setTranslation(0, initialSpawnY, 0)
                    .setLinearDamping(0.04)
                    .setAngularDamping(2.0)
                    .setCcdEnabled(true);
                carBody = world.createRigidBody(carBodyDesc);

                // Chassis Collider
                // Half-extents: length=1.95, height=0.38, width=0.80 centered at (0.22, 0.70, 0)
                const chassisColliderDesc = RAPIER.ColliderDesc.cuboid(1.95, 0.38, 0.80)
                    .setTranslation(0.22, 0.70, 0)
                    .setRestitution(0.15)
                    .setMass(CAR_MASS)
                    .setFriction(0.1);
                world.createCollider(chassisColliderDesc, carBody);

                // Four Wheel Colliders
                const wheelOffsets = [
                    { name: 'Wheel_BL', x: -1.037, y: 0.232, z: -0.703 },
                    { name: 'Wheel_BR', x: -1.037, y: 0.232, z:  0.700 },
                    { name: 'Wheel_FL', x:  1.515, y: 0.232, z: -0.694 },
                    { name: 'Wheel_FR', x:  1.515, y: 0.232, z:  0.700 }
                ];

                wheelOffsets.forEach(w => {
                    const wheelColliderDesc = RAPIER.ColliderDesc.ball(0.33)
                        .setTranslation(w.x, w.y, w.z)
                        .setMass(WHEEL_MASS)
                        .setFriction(0.05)
                        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
                        .setRestitution(0.0);
                    world.createCollider(wheelColliderDesc, carBody);
                });

                // Obstacle Generator Helper (Lightweight, knockable dynamic blocks)
                function addObstacle(x, z, width = 1.5, height = 1.5, depth = 1.5, mass = 15, color = 0xd97736, yOffset = null) {
                    const terrainH = getTerrainHeight(x, z);
                    const y = yOffset !== null ? terrainH + yOffset : terrainH + height / 2;

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

                    // 2. Rapier Dynamic Body with CCD
                    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
                        .setTranslation(x, y, z)
                        .setLinearDamping(0.3)
                        .setAngularDamping(0.5)
                        .setCcdEnabled(true);
                    const body = world.createRigidBody(bodyDesc);

                    const colliderDesc = RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2)
                        .setFriction(0.2)
                        .setRestitution(0.45)
                        .setMass(mass);
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

                // Scatter crates around the terrain hills
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
                        carScene.position.set(0, initialSpawnY, 0);

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

                    // Car local axes (+X is forward, +Z is right, +Y is up)
                    const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(carQuat);
                    const lateral = new THREE.Vector3(0, 0, 1).applyQuaternion(carQuat);
                    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(carQuat);

                    const linvel = carBody.linvel();
                    const currentVel = new THREE.Vector3(linvel.x, linvel.y, linvel.z);

                    // Calculate speed along forward and sideways directions
                    const forwardSpeed = currentVel.dot(forward);
                    const lateralSpeed = currentVel.dot(lateral);
                    const absSpeed = Math.abs(forwardSpeed);

                    // 1. Progressive Lateral Tyre Grip (Prevents sliding down slopes)
                    if (Math.abs(lateralSpeed) > 0.01) {
                        const gripImpulse = -lateralSpeed * CAR_MASS * Math.min(10.0 * delta, 0.85);
                        carBody.applyImpulse({
                            x: lateral.x * gripImpulse,
                            y: lateral.y * gripImpulse,
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
                            // Active powerful brakes if car is rolling forward
                            const brake = Math.min(BRAKE_FORCE * delta, forwardSpeed * CAR_MASS * 0.95);
                            carBody.applyImpulse({
                                x: -forward.x * brake,
                                y: -forward.y * brake,
                                z: -forward.z * brake
                            }, true);
                        } else if (forwardSpeed > -MAX_REVERSE_SPEED) {
                            // Fast, punchy reverse gear
                            const force = REVERSE_FORCE * delta;
                            carBody.applyImpulse({
                                x: -forward.x * force,
                                y: -forward.y * force,
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
                                y: forward.y * decel * decelDir,
                                z: forward.z * decel * decelDir
                            }, true);
                        } else {
                            // Smoothly settle car to rest when nearly stopped to prevent micro-drift
                            const currentLinvel = carBody.linvel();
                            carBody.setLinvel({ x: 0, y: currentLinvel.y, z: 0 }, true);
                        }
                    }

                    // 3. Realistic Speed-Sensitive Ackermann Steering
                    const speedKmh = absSpeed * 3.6;

                    // Speed-sensitive steering factor (nimble at slow speeds, calm & stable at high speeds)
                    const speedFactor = THREE.MathUtils.clamp(1.0 - (speedKmh / 110) * 0.78, 0.20, 1.0);
                    const maxSteerAngle = 0.30 * speedFactor;

                    let targetSteer = 0;
                    if (keys.a) targetSteer = maxSteerAngle;
                    if (keys.d) targetSteer = -maxSteerAngle;

                    // Smooth progressive steering wheel turn
                    const steerLerpSpeed = (targetSteer === 0) ? 0.18 : 0.08;
                    currentSteerAngle = THREE.MathUtils.lerp(currentSteerAngle, targetSteer, steerLerpSpeed);

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
                        const maxYawRate = THREE.MathUtils.lerp(2.2, 1.0, THREE.MathUtils.clamp(speedKmh / 90, 0, 1));
                        targetYawRate = (forwardSpeed / WHEELBASE) * Math.tan(currentSteerAngle);
                        targetYawRate = THREE.MathUtils.clamp(targetYawRate, -maxYawRate, maxYawRate);
                    }
                    const newYaw = THREE.MathUtils.lerp(currentYaw, targetYawRate, 0.2);

                    // Preserve natural terrain pitch/roll while gently damping excessive roll/pitch
                    const newPitch = currentPitch * 0.94;
                    const newRoll = currentRoll * 0.88;

                    const newAngVec = new THREE.Vector3()
                        .addScaledVector(up, newYaw)
                        .addScaledVector(lateral, newPitch)
                        .addScaledVector(forward, newRoll);

                    carBody.setAngvel(newAngVec, true);

                    // Upright stabilization spring (keeps car naturally aligned to terrain normal without flipping)
                    const uprightAngle = Math.acos(THREE.MathUtils.clamp(up.y, -1, 1));
                    if (uprightAngle > 0.03) {
                        const correctionAxis = new THREE.Vector3(0, 1, 0).cross(up).normalize();
                        const torque = uprightAngle * CAR_MASS * 8.0 * delta;
                        carBody.applyTorqueImpulse({
                            x: -correctionAxis.x * torque,
                            y: -correctionAxis.y * torque,
                            z: -correctionAxis.z * torque
                        }, true);
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

                    // Live HUD Speedometer & Nitro updates
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

                    // Dynamic Shadow Follow: Keep high-res shadow projection centered on car
                    directionalLight.target.position.copy(carCenter);
                    directionalLight.position.copy(carCenter).add(sunOffset);
                    directionalLight.target.updateMatrixWorld();

                    // 1. Rigidly translate camera and look-target by car displacement so camera NEVER falls behind
                    if (!prevCarCenter) {
                        prevCarCenter = carCenter.clone();
                    }
                    const carDelta = new THREE.Vector3().subVectors(carCenter, prevCarCenter);
                    prevCarCenter.copy(carCenter);
                    camera.position.add(carDelta);
                    currentLookTarget.add(carDelta);

                    // Safety net: Auto-respawn car if it drops far below terrain or leaves bounds
                    if (translation.y < -30.0 || Math.abs(translation.x) > 115 || Math.abs(translation.z) > 115) {
                        const respawnY = getTerrainHeight(0, 0) + 0.45;
                        carBody.setTranslation({ x: 0, y: respawnY, z: 0 }, true);
                        carBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
                        carBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
                        carBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
                    }

                    // Car forward orientation (+X is forward)
                    const carQuat = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
                    const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(carQuat);

                    // Determine if car is driving vs stationary/not moving
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

                    // Forward vs Reverse camera mode:
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

                    // Follow distance & height
                    const targetDist = isBoosting ? 8.2 : 7.0;
                    const targetHeight = isBoosting ? 2.3 : 2.1;
                    const zoomLerpSpeed = 1.0 - Math.exp(-2.5 * delta);
                    currentFollowDist = THREE.MathUtils.lerp(currentFollowDist, targetDist, zoomLerpSpeed);
                    currentFollowHeight = THREE.MathUtils.lerp(currentFollowHeight, targetHeight, zoomLerpSpeed);

                    const lateralCam = new THREE.Vector3(-forward.z, 0, forward.x);
                    const arcSide = (1.0 - currentCamDir * currentCamDir) * (currentFollowDist * 0.7);

                    const desiredCamPos = new THREE.Vector3()
                        .copy(carCenter)
                        .addScaledVector(forward, currentCamDir * currentFollowDist)
                        .addScaledVector(lateralCam, arcSide);
                    desiredCamPos.y = carCenter.y + (currentFollowHeight - 0.85);

                    // Prevent camera from clipping through terrain hills
                    const camTerrainH = getTerrainHeight(desiredCamPos.x, desiredCamPos.z);
                    if (desiredCamPos.y < camTerrainH + 0.8) {
                        desiredCamPos.y = camTerrainH + 0.8;
                    }

                    const carTargetLook = new THREE.Vector3(carCenter.x, carCenter.y + 0.55, carCenter.z);

                    if (cameraModeRef.current === 'free_orbit') {
                        controls.enabled = true;
                        controls.target.copy(carCenter);
                        controls.update();
                        currentLookTarget.copy(controls.target);
                    } else if (isDrivingState) {
                        controls.enabled = false;

                        const followSpeed = 1.0 - Math.exp(-12.0 * delta);
                        camera.position.lerp(desiredCamPos, followSpeed);

                        // Strict distance clamp
                        const toCamNow = new THREE.Vector3().subVectors(camera.position, carCenter);
                        toCamNow.y = 0;
                        const currentDist = toCamNow.length();
                        const maxAllowedDist = currentFollowDist * 1.06;
                        if (currentDist > maxAllowedDist && currentDist > 0.01) {
                            toCamNow.normalize().multiplyScalar(maxAllowedDist);
                            camera.position.x = carCenter.x + toCamNow.x;
                            camera.position.z = carCenter.z + toCamNow.z;
                        }

                        currentLookTarget.lerp(carTargetLook, 1.0 - Math.exp(-14.0 * delta));
                        camera.lookAt(currentLookTarget);
                        controls.target.copy(carCenter);

                    } else {
                        controls.enabled = true;
                        controls.target.copy(carCenter);

                        if (userHasManuallyOrbited) {
                            controls.update();
                            currentLookTarget.copy(controls.target);
                        } else {
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

            geometry.dispose();
            material.dispose();
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

            {/* Dashboard / Controls HUD */}
            <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 pointer-events-none select-none">
                <div className="bg-neutral-900/90 backdrop-blur-md border border-neutral-700/60 rounded-2xl p-4 shadow-2xl text-white font-mono text-xs space-y-3 min-w-[260px]">
                    {/* Header with Title and Live Speed */}
                    <div className="flex items-center justify-between gap-4 pb-2 border-b border-neutral-700/80">
                        <div className="flex items-center gap-2">
                            <span className="text-lg">🏎️</span>
                            <div>
                                <div className="text-white font-black tracking-wider text-xs">CAR DASH</div>
                                <div className="text-[10px] text-emerald-400 font-semibold">IRREGULAR TERRAIN</div>
                            </div>
                        </div>
                        {/* Live Speedometer */}
                        <div className="flex items-baseline gap-1 bg-black/60 px-3 py-1 rounded-lg border border-neutral-800">
                            <span ref={speedRef} className="text-amber-400 font-black text-xl leading-none">0</span>
                            <span className="text-[10px] text-neutral-400 font-bold">KM/H</span>
                        </div>
                    </div>

                    {/* Status Badges */}
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                        <div ref={gearRef} className="text-xs font-mono font-bold text-neutral-400">NEUTRAL</div>
                        <div ref={nitroBadgeRef} className="text-xs font-bold px-2 py-0.5 rounded-md font-mono text-neutral-400 bg-white/5">HOLD SHIFT</div>
                    </div>

                    {/* Key controls */}
                    <div className="space-y-1.5 pt-1 text-[11px]">
                        <div className="flex justify-between gap-4 text-neutral-300">
                            <span className="text-neutral-400">Drive / Reverse:</span>
                            <span className="font-bold text-white">W / S (or ↑ / ↓)</span>
                        </div>
                        <div className="flex justify-between gap-4 text-neutral-300">
                            <span className="text-neutral-400">Steer:</span>
                            <span className="font-bold text-white">A / D (or ← / →)</span>
                        </div>
                        <div className="flex justify-between gap-4 text-neutral-300">
                            <span className="text-neutral-400">Turbo Nitro:</span>
                            <span className="font-bold text-amber-400">SHIFT + W</span>
                        </div>
                        <div className="flex justify-between gap-4 text-neutral-300">
                            <span className="text-neutral-400">Reset Drop:</span>
                            <span className="font-bold text-cyan-400">R</span>
                        </div>
                    </div>

                    {/* Interactive Toggle Buttons */}
                    <div className="flex gap-2 pt-2 border-t border-neutral-800/80">
                        <button
                            onClick={() => setDebugVisible(v => !v)}
                            className="pointer-events-auto flex-1 py-1 rounded-lg text-[10px] font-bold cursor-pointer transition-colors bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/10"
                        >
                            {debugVisible ? 'COLLIDERS: ON [C]' : 'COLLIDERS: OFF [C]'}
                        </button>
                        <button
                            onClick={() => setCameraMode(prev => prev === 'auto' ? 'free_orbit' : 'auto')}
                            className="pointer-events-auto flex-1 py-1 rounded-lg text-[10px] font-bold cursor-pointer transition-colors bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/10"
                        >
                            <span ref={cameraBadgeRef}>CAMERA [V]</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ThreeScene;
