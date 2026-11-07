import * as THREE from 'three';
import { useEffect, useRef, useState } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import RAPIER from '@dimforge/rapier3d-compat';

function ThreeScene() {
    const mountRef = useRef(null);
    const speedRef = useRef(null);
    const [debugVisible, setDebugVisible] = useState(true);
    const debugVisibleRef = useRef(true);

    // Keep ref in sync for animation loop
    useEffect(() => {
        debugVisibleRef.current = debugVisible;
    }, [debugVisible]);

    useEffect(() => {
        let isMounted = true;
        let animationId;
        let world = null;
        let carBody = null;
        let carScene = null;
        const clock = new THREE.Clock();

        // Driving Tuning Parameters
        const CAR_MASS = 1500;          // 1500 kg Real Car Mass
        const WHEEL_MASS = 25;          // 25 kg per wheel
        const MAX_FORWARD_SPEED = 14;   // ~50 km/h top speed
        const MAX_REVERSE_SPEED = 5;    // ~18 km/h max reverse
        const ACCEL_FORCE = CAR_MASS * 5.5;  // Scaled for 1500kg car (~8250 N)
        const BRAKE_FORCE = CAR_MASS * 9.0;  // Strong brakes (~13500 N)
        const COAST_DECEL = CAR_MASS * 1.8;  // Natural engine friction (~2700 N)
        const STEER_RATE = 1.35;        // Controlled steering responsiveness
        const WHEEL_RADIUS = 0.325;     // Matches wheel collider

        // Visual steering pivots & wheel meshes
        let steerFL = null;
        let steerFR = null;
        const wheels = [];
        let currentSteerAngle = 0;

        const container = mountRef.current;
        if (!container) return;

        // 1. Scene
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x181a1f);

        // 2. Camera
        const camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        camera.position.set(5, 4, 7);
        camera.lookAt(0, 0.5, 0);

        // 3. Renderer (Fix: PCFShadowMap instead of removed PCFSoftShadowMap)
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        container.appendChild(renderer.domElement);

        // 4. OrbitControls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.target.set(0, 0.5, 0);
        controls.maxPolarAngle = Math.PI / 2 - 0.05;
        controls.minDistance = 2;
        controls.maxDistance = 60;

        // 5. Solid Ground Mesh
        const groundWidth = 50;
        const groundThickness = 1;
        const groundDepth = 50;

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

        // 5. Solid Ground Mesh
        const patthar = new THREE.BoxGeometry(2,2,2);
        const pattharMaterial = new THREE.MeshStandardMaterial({
            color: 0x1f2337,
            roughness: 0.85,
            metalness: 0.1
        });
        const pattharMesh = new THREE.Mesh(patthar, pattharMaterial);
        pattharMesh.position.y = -groundThickness / 2; // Top surface at Y = 0.0
        pattharMesh.receiveShadow = true;
        scene.add(pattharMesh);

        // Visual Grid (placed at 1mm so it doesn't slice through tyres)
        const grid = new THREE.GridHelper(groundWidth, groundWidth, 0x00ff88, 0x3a3f47);
        grid.position.y = 0.001;
        scene.add(grid);

        // 6. Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 2.5);
        directionalLight.position.set(12, 18, 12);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 50;
        directionalLight.shadow.camera.left = -20;
        directionalLight.shadow.camera.right = 20;
        directionalLight.shadow.camera.top = 20;
        directionalLight.shadow.camera.bottom = -20;
        directionalLight.shadow.bias = -0.0005;
        scene.add(directionalLight);

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
            d: false
        };

        const handleKeyDown = (e) => {
            const k = e.key.toLowerCase();
            if (k === 'w' || k === 'arrowup') keys.w = true;
            if (k === 's' || k === 'arrowdown') keys.s = true;
            if (k === 'a' || k === 'arrowleft') keys.a = true;
            if (k === 'd' || k === 'arrowright') keys.d = true;

            // R: Reset car to air (2m height)
            if (k === 'r' && carBody) {
                carBody.setTranslation({ x: 0, y: 3.0, z: 0 }, true);
                carBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
                carBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
                carBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
            }

            // C: Toggle colliders wireframe
            if (k === 'c') {
                setDebugVisible(prev => !prev);
            }
        };

        const handleKeyUp = (e) => {
            const k = e.key.toLowerCase();
            if (k === 'w' || k === 'arrowup') keys.w = false;
            if (k === 's' || k === 'arrowdown') keys.s = false;
            if (k === 'a' || k === 'arrowleft') keys.a = false;
            if (k === 'd' || k === 'arrowright') keys.d = false;
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        // 9. Asynchronously Initialize Rapier WASM & Create Physics World
        async function initPhysics() {
            try {
                // Await WASM initialization
                await RAPIER.init();
                if (!isMounted) return;

                // Realistic Stronger Gravity (Negative pulls DOWNWARDS)
                const gravity = { x: 0.0, y: -18.0, z: 0.0 };
                world = new RAPIER.World(gravity);

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

                // Dynamic Car RigidBody (Spawns 2.5m above ground to demonstrate drop)
                const carBodyDesc = RAPIER.RigidBodyDesc.dynamic()
                    .setTranslation(0, 2.5, 0)
                    .setLinearDamping(0.6)
                    .setAngularDamping(2.0);
                carBody = world.createRigidBody(carBodyDesc);

                // Chassis Collider (Lower center of mass at Y = 0.45 for high stability)
                const chassisColliderDesc = RAPIER.ColliderDesc.cuboid(1.8, 0.35, 0.7)
                    .setTranslation(0.2, 0.45, 0)
                    .setRestitution(0.0)
                    .setMass(CAR_MASS)
                    .setFriction(0.2);
                world.createCollider(chassisColliderDesc, carBody);

                // Four Wheel Colliders (0.15 rolling friction allows smooth rolling without drag)
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
                        .setFriction(0.15)
                        .setRestitution(0.0);
                    world.createCollider(wheelColliderDesc, carBody);
                });

                // Load 3D Car GLB Model
                const loader = new GLTFLoader();
                loader.load(
                    '/car.glb',
                    (gltf) => {
                        if (!isMounted) return;
                        carScene = gltf.scene;

                        // Spawn visually at initial physics body position
                        carScene.position.set(0, 2.5, 0);

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

                    // 1. Lateral Tyre Grip (Prevents unnatural ice-skate sliding)
                    if (Math.abs(lateralSpeed) > 0.02) {
                        const gripCorrection = -lateralSpeed * 0.75;
                        carBody.applyImpulse({
                            x: lateral.x * gripCorrection,
                            y: 0,
                            z: lateral.z * gripCorrection
                        }, true);
                    }

                    // 2. Acceleration / Braking / Coasting (W & S)
                    if (keys.w) {
                        // Accelerate up to MAX_FORWARD_SPEED smoothly
                        if (forwardSpeed < MAX_FORWARD_SPEED) {
                            const force = ACCEL_FORCE * delta;
                            carBody.applyImpulse({
                                x: forward.x * force,
                                y: 0,
                                z: forward.z * force
                            }, true);
                        }
                    } else if (keys.s) {
                        if (forwardSpeed > 0.4) {
                            // Active Brake if moving forward
                            const brake = Math.min(BRAKE_FORCE * delta, forwardSpeed * 0.85);
                            carBody.applyImpulse({
                                x: -forward.x * brake,
                                y: 0,
                                z: -forward.z * brake
                            }, true);
                        } else if (forwardSpeed > -MAX_REVERSE_SPEED) {
                            // Reverse drive
                            const force = (ACCEL_FORCE * 0.45) * delta;
                            carBody.applyImpulse({
                                x: -forward.x * force,
                                y: 0,
                                z: -forward.z * force
                            }, true);
                        }
                    } else {
                        // Natural rolling resistance (coast to gentle stop when no key pressed)
                        if (absSpeed > 0.08) {
                            const decel = Math.min(COAST_DECEL * delta, absSpeed);
                            const decelDir = forwardSpeed > 0 ? -1 : 1;
                            carBody.applyImpulse({
                                x: forward.x * decel * decelDir,
                                y: 0,
                                z: forward.z * decel * decelDir
                            }, true);
                        }
                    }

                    // 3. Smooth Steering (A & D)
                    const maxSteerVisual = 0.5; // ~28 degrees
                    let targetSteer = 0;
                    if (keys.a) targetSteer = maxSteerVisual;
                    if (keys.d) targetSteer = -maxSteerVisual;

                    currentSteerAngle = THREE.MathUtils.lerp(currentSteerAngle, targetSteer, 0.15);
                    if (steerFL) steerFL.rotation.y = currentSteerAngle;
                    if (steerFR) steerFR.rotation.y = currentSteerAngle;

                    // Car body turns proportionally to momentum
                    if (absSpeed > 0.3) {
                        const turnFactor = Math.min(absSpeed / 3.0, 1.0);
                        const turnDir = (forwardSpeed >= -0.2) ? 1 : -1; // Reverse flips steer
                        if (keys.a) {
                            carBody.setAngvel({ x: 0, y: STEER_RATE * turnFactor * turnDir, z: 0 }, true);
                        } else if (keys.d) {
                            carBody.setAngvel({ x: 0, y: -STEER_RATE * turnFactor * turnDir, z: 0 }, true);
                        } else {
                            // Dampen spin when steering keys released
                            const ang = carBody.angvel();
                            carBody.setAngvel({ x: 0, y: ang.y * 0.85, z: 0 }, true);
                        }
                    } else {
                        // Stop spinning when vehicle is stationary
                        carBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
                    }

                    // 4. Physically Accurate Wheel Spin (Roll angle matched to exact distance moved)
                    const rollDelta = (forwardSpeed * delta) / WHEEL_RADIUS;
                    wheels.forEach(wheel => {
                        wheel.rotateX(-rollDelta);
                    });

                    // Live HUD Speedometer Update (Zero React re-render overhead)
                    if (speedRef.current) {
                        const kmh = Math.round(absSpeed * 3.6);
                        speedRef.current.innerText = `${kmh} KM/H`;
                    }
                }

                // Step physics simulation
                world.step();

                // Synchronize visual car with physics
                if (carScene && carBody) {
                    const translation = carBody.translation();
                    const rotation = carBody.rotation();
                    carScene.position.set(translation.x, translation.y, translation.z);
                    carScene.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

                    // Camera target smoothly follows car
                    controls.target.lerp(carScene.position, 0.1);
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

            controls.update();
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

            groundGeometry.dispose();
            groundMaterial.dispose();
            grid.dispose();
            debugGeometry.dispose();
            debugMaterial.dispose();
            controls.dispose();
            renderer.dispose();

            if (renderer.domElement && renderer.domElement.parentNode) {
                renderer.domElement.parentNode.removeChild(renderer.domElement);
            }
        };

    }, []);

    return (
        <div className="fixed inset-0 w-full h-full overflow-hidden">
            <div ref={mountRef} className="w-full h-full" />

            {/* HUD / Controls Overlay */}
            <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 pointer-events-none select-none">
                <div className="bg-neutral-900/85 backdrop-blur-md border border-neutral-700/60 rounded-xl px-4 py-3 shadow-2xl text-white font-mono text-xs space-y-2">
                    <div className="flex items-center justify-between gap-4 pb-1.5 border-b border-neutral-700">
                        <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                            <span>🏎️</span>
                            <span>CAR DASH</span>
                        </div>
                        {/* Live Speedometer */}
                        <div ref={speedRef} className="text-amber-400 font-black text-sm bg-neutral-950/80 px-2.5 py-0.5 rounded border border-neutral-800">
                            0 KM/H
                        </div>
                    </div>
                    <div className="flex justify-between gap-4">
                        <span className="text-neutral-400">Drive / Reverse:</span>
                        <span className="font-bold text-white">W / S (or ↑ / ↓)</span>
                    </div>
                    <div className="flex justify-between gap-4">
                        <span className="text-neutral-400">Steer:</span>
                        <span className="font-bold text-white">A / D (or ← / →)</span>
                    </div>
                    <div className="flex justify-between gap-4">
                        <span className="text-neutral-400">Reset Drop:</span>
                        <span className="font-bold text-amber-400">R</span>
                    </div>
                    <div className="flex justify-between gap-4 items-center pt-1 border-t border-neutral-800">
                        <span className="text-neutral-400">Colliders:</span>
                        <button
                            onClick={() => setDebugVisible(v => !v)}
                            className="pointer-events-auto px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer transition-colors bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/40"
                        >
                            {debugVisible ? 'VISIBLE [C]' : 'HIDDEN [C]'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ThreeScene;
