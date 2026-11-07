import * as THREE from 'three';
import { useEffect, useRef } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import RAPIER from '@dimforge/rapier3d';

function ThreeScene() {
    const mountRef = useRef(null);

    useEffect(() => {
        let isMounted = true;
        let animationId;

        const container = mountRef.current;
        if (!container) return;
        // 1. Create scene
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x202020);

        //  Initialize Rapier Physics World
        const gravity = { x: 0.0, y: -10, z: 0.0 };
        const world = new RAPIER.World(gravity);

        // 2. Create camera
        const camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );

        camera.position.set(5, 4, 7);
        camera.lookAt(0, 0.5, 0);

        // 3. Create renderer
        const renderer = new THREE.WebGLRenderer({ antialias: true });

        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(renderer.domElement);


        // 4. PHASE 1: GROUND SETUP (THREE.JS MESH + RAPIER COLLIDER)
        const groundWidth = 50;
        const groundThickness = 1;
        const groundDepth = 50;

        // Visual Solid Ground Slab
        const groundGeometry = new THREE.BoxGeometry(groundWidth, groundThickness, groundDepth);
        const groundMaterial = new THREE.MeshStandardMaterial({
            color: 0x1f2227, // Dark asphalt color
            roughness: 0.85, // Matte finish
            metalness: 0.1
        });
        const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
        // Important: Box center is at 0, so height 1 spans from -0.5 to +0.5.
        // Moving Y to -0.5 places the top surface precisely at Y = 0.0
        groundMesh.position.y = -groundThickness / 2;
        groundMesh.receiveShadow = true;
        scene.add(groundMesh);

        // Visual Grid Helper on Ground Surface
        const grid = new THREE.GridHelper(groundWidth, groundWidth, 0x00ff88, 0x3a3f47);
        grid.position.y = 0.005; // 5mm above ground to prevent z-fighting flicker
        scene.add(grid);

        // Rapier Static Physics Ground Collider
        const groundBodyDesc = RAPIER.RigidBodyDesc.fixed();
        const groundBody = world.createRigidBody(groundBodyDesc);

        // Rapier cuboids take HALF-extents: (width/2, thickness/2, depth/2)
        const groundColliderDesc = RAPIER.ColliderDesc.cuboid(
            groundWidth / 2,
            groundThickness / 2,
            groundDepth / 2
        )
            .setTranslation(0, -groundThickness / 2, 0)
            .setRestitution(0.0) // Zero bounce: solid landing
            .setFriction(0.8);   // Good road tire grip
        world.createCollider(groundColliderDesc, groundBody);

        // 5. Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 2.5);
        directionalLight.position.set(10, 16, 10);
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


                // ----------------------------------------------------
        // PHASE 2A: CAR PHYSICS BODY & 5 COMPOUND COLLIDERS
        // ----------------------------------------------------
        // 1. Dynamic RigidBody (The physical car entity)
        const carBodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(0, 2.0, 0) // Spawn 2 meters above ground
            .setLinearDamping(0.5)     // Air resistance
            .setAngularDamping(1.0);   // Stop rotation wobbling
        const carBody = world.createRigidBody(carBodyDesc);

        // 2. Chassis Collider (Elevated body cuboid)
        // Half extents: length=1.8, height=0.35, width=0.7
        const chassisColliderDesc = RAPIER.ColliderDesc.cuboid(1.8, 0.35, 0.7)
            .setTranslation(0.2, 0.65, 0) // Bottom sits at 0.65 - 0.35 = 0.30m (well above ground)
            .setRestitution(0.0)
            .setFriction(0.2);
        world.createCollider(chassisColliderDesc, carBody);

        // 3. Four Wheel Colliders (Exact radius 0.312 at model wheel offsets)
        const wheelOffsets = [
            { name: 'Wheel_BL', x: -1.037, y: 0.232, z: -0.703 }, // Back Left
            { name: 'Wheel_BR', x: -1.037, y: 0.232, z:  0.700 }, // Back Right
            { name: 'Wheel_FL', x:  1.515, y: 0.232, z: -0.694 }, // Front Left
            { name: 'Wheel_FR', x:  1.515, y: 0.232, z:  0.700 }  // Front Right
        ];

        const WHEEL_RADIUS = 0.312; // Matches tyre radius perfectly

        wheelOffsets.forEach(w => {
            const wheelColliderDesc = RAPIER.ColliderDesc.ball(WHEEL_RADIUS)
                .setTranslation(w.x, w.y, w.z)
                .setFriction(1.2)      // High tyre traction
                .setRestitution(0.0);  // Zero bounce: prevents bouncing upwards
            world.createCollider(wheelColliderDesc, carBody);
        });

                // ----------------------------------------------------
        // PHASE 2B: LOAD 3D CAR MODEL (/car.glb)
        // ----------------------------------------------------
        let carScene = null;
        const loader = new GLTFLoader();
        loader.load(
            '/car.glb',
            (gltf) => {
                if (!isMounted) return;
                carScene = gltf.scene;

                // Enable shadow casting & receiving on all meshes (body + wheels)
                carScene.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });

                scene.add(carScene);
                console.log('✅ [ThreeScene] Car model loaded successfully');
            },
            undefined,
            (error) => {
                console.error('❌ [ThreeScene] Error loading /car.glb:', error);
            }
        );


        // 6. Animation & Physics Step Loop
        function animate() {
            if (!isMounted) return;
            animationId = requestAnimationFrame(animate);

            try {
                // Advance physics simulation
                world.step();

                // Synchronize Three.js visual car model with Rapier physics body
                if (carScene && carBody) {
                    const translation = carBody.translation();
                    const rotation = carBody.rotation();
                    carScene.position.set(translation.x, translation.y, translation.z);
                    carScene.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
                }
            } catch (err) {
                console.warn('Physics step warning:', err);
            }

            renderer.render(scene, camera);
        }

        animate();

        // 7. Resize Handler
        function handleResize() {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        }

        window.addEventListener('resize', handleResize);

        // 8. Safe Cleanup on Component Unmount
        return () => {
            isMounted = false;
            cancelAnimationFrame(animationId);
            window.removeEventListener('resize', handleResize);

            groundGeometry.dispose();
            groundMaterial.dispose();
            grid.dispose();
            renderer.dispose();

            if (renderer.domElement && renderer.domElement.parentNode) {
                renderer.domElement.parentNode.removeChild(renderer.domElement);
            }
        };

    }, []);

    return (
        <div
            ref={mountRef}
            className="fixed inset-0 w-full h-full overflow-hidden"
        />
    );
}

export default ThreeScene;