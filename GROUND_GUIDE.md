# Complete Three.js + Rapier 3D Game Guide: Ground & Car Physics

Yeh guide aapko **file name**, **exact line numbers / insertion points**, aur **detailed explanation** ke sath batayegi ki kahan par kaunsa code likhna hai.

---

## Table of Contents
1. [Project Overview & Files Involved](#1-project-overview--files-involved)
2. [Model Inspection: `public/car.glb` Ke Dimensions & Math](#2-model-inspection-publiccarglb-ke-dimensions--math)
3. [Step-by-Step Code Insertions in `src/components/three.jsx`](#3-step-by-step-code-insertions-in-srccomponentsthreejsx)
   - [Step 1: Top Imports (Lines 1–2)](#step-1-top-imports-lines-12)
   - [Step 2: Rapier World Initialization](#step-2-rapier-world-initialization)
   - [Step 3: Camera Game Perspective](#step-3-camera-game-perspective)
   - [Step 4: Enable Shadows on WebGLRenderer](#step-4-enable-shadows-on-webglrenderer)
   - [Step 5: Replace Box with Solid Ground & Rapier Collider](#step-5-replace-box-with-solid-ground--rapier-collider)
   - [Step 6: Configure Directional Light for Shadows](#step-6-configure-directional-light-for-shadows)
   - [Step 7: Add Car RigidBody & 5 Compound Colliders](#step-7-add-car-rigidbody--5-compound-colliders)
   - [Step 8: Load `/car.glb` using GLTFLoader](#step-8-load-carglb-using-gltfloader)
   - [Step 9: Update Physics & Animation Loop](#step-9-update-physics--animation-loop)
   - [Step 10: StrictMode-Safe Component Cleanup](#step-10-strictmode-safe-component-cleanup)
4. [Complete Ready-to-Use File: `src/components/three.jsx`](#4-complete-ready-to-use-file-srccomponentsthreejsx)
5. [Troubleshooting: Blank Screen / Kuch Dikhai Na Dena](#5-troubleshooting-blank-screen--kuch-dikhai-na-dena)

---

## 1. Project Overview & Files Involved

| File Path | Role in Project | Changes Required |
| :--- | :--- | :--- |
| **`src/components/three.jsx`** | Main 3D Canvas component | **Saare code changes isi file mein honge.** Yahan Three.js scene, Rapier physics, ground, aur car setup hoga. |
| **`public/car.glb`** | 3D Car Model Asset | Already present. Isko modify nahi karna hai; `GLTFLoader` isko direct `/car.glb` se load karega. |
| **`package.json`** | Dependencies list | Already contains `three` and `@dimforge/rapier3d`. |

---

## 2. Model Inspection: `public/car.glb` Ke Dimensions & Math

Humne aapki `public/car.glb` file ko inspect kiya hai. Model ka exact breakdown yeh hai:

```
Scene Root (0, 0, 0)
├── body (Group) -------------------> [0.05, 0.55, 0.00] (Height: 0.15m se 1.16m tak)
├── Steer_BL (Pivot) ---------------> [-1.037, 0.232, -0.703]
│   └── Wheel_BL (Mesh) ------------> Back Left Tyre (Bottom edge: Y = -0.080)
├── Steer_BR (Pivot) ---------------> [-1.037, 0.232,  0.700]
│   └── Wheel_BR (Mesh) ------------> Back Right Tyre (Bottom edge: Y = -0.080)
├── Steer_FL (Pivot) ---------------> [ 1.515, 0.232, -0.694]
│   └── Wheel_FL (Mesh) ------------> Front Left Tyre (Bottom edge: Y = -0.080)
└── Steer_FR (Pivot) ---------------> [ 1.515, 0.232,  0.700]
    └── Wheel_FR (Mesh) ------------> Front Right Tyre (Bottom edge: Y = -0.080)
```

### Tyre Math:
1. **Wheel Center Height**: Sabhi 4 wheels ka pivot $Y = 0.232\text{m}$ par hai.
2. **Tyre Lowest Surface in 3D Mesh**: Tyre ka sabse nichla hissa $Y = -0.0798\text{m}$ ($\approx -0.080\text{m}$) par hai.
3. **Exact Wheel Radius**:
   $$\text{Radius} = 0.232 - (-0.080) = \mathbf{0.312\text{ meters}}$$
4. **Landing Contact Calculation**:
   - Rapier mein $0.312\text{m}$ radius ka ball collider $Y = 0.232$ par lagane par:
   - Lowest physics contact point = $0.232 - 0.312 = \mathbf{-0.080\text{m}}$.
   - Visual 3D tyre ka lowest point = $\mathbf{-0.080\text{m}}$.
   - Is se tyre aur ground exact $Y = 0.000$ par touch karte hain bina kisi penetration ya gap ke.

---

## 3. Step-by-Step Code Insertions in `src/components/three.jsx`

### Step 1: Top Imports (Lines 1–2)
```javascript
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d';
```

### Step 2: Rapier World Initialization
```javascript
const gravity = { x: 0.0, y: -9.81, z: 0.0 };
const world = new RAPIER.World(gravity);
```

### Step 3: Camera Game Perspective
```javascript
camera.position.set(5, 4, 7);
camera.lookAt(0, 0.5, 0);
```

### Step 4: Enable Shadows on WebGLRenderer
```javascript
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
```

### Step 5: Replace Box with Solid Ground & Rapier Collider
```javascript
// --- Ground Visual Slab ---
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

// --- Grid Helper ---
const grid = new THREE.GridHelper(groundWidth, groundWidth, 0x00ff88, 0x3a3f47);
grid.position.y = 0.005; // Lifted by 5mm to prevent z-fighting
scene.add(grid);

// --- Rapier Static Ground Collider ---
const groundBodyDesc = RAPIER.RigidBodyDesc.fixed();
const groundBody = world.createRigidBody(groundBodyDesc);
const groundColliderDesc = RAPIER.ColliderDesc.cuboid(
    groundWidth / 2,
    groundThickness / 2,
    groundDepth / 2
)
    .setTranslation(0, -groundThickness / 2, 0)
    .setRestitution(0.0) // Zero bounce: solid landing
    .setFriction(0.8);   // Realistic road grip
world.createCollider(groundColliderDesc, groundBody);
```

### Step 6: Configure Directional Light for Shadows
```javascript
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
```

### Step 7: Add Car RigidBody & 5 Compound Colliders
```javascript
// Dynamic Car Body
const carBodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(0, 2.0, 0) // Spawn 2m above ground
    .setLinearDamping(0.5)
    .setAngularDamping(1.0);
const carBody = world.createRigidBody(carBodyDesc);

// Chassis Collider (Bottom sits at Y = 0.30m, well above ground)
const chassisColliderDesc = RAPIER.ColliderDesc.cuboid(1.8, 0.35, 0.7)
    .setTranslation(0.2, 0.65, 0)
    .setRestitution(0.0)
    .setFriction(0.2);
world.createCollider(chassisColliderDesc, carBody);

// 4 Wheel Colliders (Exact radius 0.312 at model wheel offsets)
const wheelOffsets = [
    { name: 'Wheel_BL', x: -1.037, y: 0.232, z: -0.703 },
    { name: 'Wheel_BR', x: -1.037, y: 0.232, z:  0.700 },
    { name: 'Wheel_FL', x:  1.515, y: 0.232, z: -0.694 },
    { name: 'Wheel_FR', x:  1.515, y: 0.232, z:  0.700 }
];

const WHEEL_RADIUS = 0.312;

wheelOffsets.forEach(w => {
    const wheelColliderDesc = RAPIER.ColliderDesc.ball(WHEEL_RADIUS)
        .setTranslation(w.x, w.y, w.z)
        .setFriction(1.2)
        .setRestitution(0.0);
    world.createCollider(wheelColliderDesc, carBody);
});
```

### Step 8: Load `/car.glb` using GLTFLoader
```javascript
let carScene = null;
const loader = new GLTFLoader();
loader.load(
    '/car.glb',
    (gltf) => {
        carScene = gltf.scene;
        carScene.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        scene.add(carScene);
        console.log('✅ Car model loaded successfully');
    },
    undefined,
    (error) => {
        console.error('❌ Error loading /car.glb:', error);
    }
);
```

### Step 9: Update Physics & Animation Loop
```javascript
let animationId;
let isMounted = true;

function animate() {
    if (!isMounted) return;
    animationId = requestAnimationFrame(animate);

    try {
        world.step();

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
```

### Step 10: StrictMode-Safe Component Cleanup
React 18/19 development mode mein `useEffect` do baar chalta hai. Safe cleanup likhna zaroori hai:
```javascript
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
```

---

## 4. Complete Ready-to-Use File: `src/components/three.jsx`

Yeh poora crash-proof file code hai. Isko directly copy karke paste kar sakte hain:

```jsx
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d';

function ThreeScene() {
    const mountRef = useRef(null);

    useEffect(() => {
        let isMounted = true;
        let animationId;

        // Container Check
        const container = mountRef.current;
        if (!container) return;

        // ----------------------------------------------------
        // 1. RAPIER PHYSICS WORLD INITIALIZATION
        // ----------------------------------------------------
        const gravity = { x: 0.0, y: -9.81, z: 0.0 };
        const world = new RAPIER.World(gravity);

        // ----------------------------------------------------
        // 2. THREE.JS SCENE, CAMERA, RENDERER
        // ----------------------------------------------------
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x121417);

        const camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        camera.position.set(5, 4, 7);
        camera.lookAt(0, 0.5, 0);

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(renderer.domElement);

        // ----------------------------------------------------
        // 3. PHASE 1: GROUND SETUP (THREE.JS + RAPIER)
        // ----------------------------------------------------
        const groundWidth = 50;
        const groundThickness = 1;
        const groundDepth = 50;

        // Visual Ground Slab
        const groundGeometry = new THREE.BoxGeometry(groundWidth, groundThickness, groundDepth);
        const groundMaterial = new THREE.MeshStandardMaterial({
            color: 0x1f2227,
            roughness: 0.85,
            metalness: 0.1
        });
        const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
        groundMesh.position.y = -groundThickness / 2; // Surface flush at Y = 0.0
        groundMesh.receiveShadow = true;
        scene.add(groundMesh);

        // Visual Grid on ground surface
        const grid = new THREE.GridHelper(groundWidth, groundWidth, 0x00ff88, 0x3a3f47);
        grid.position.y = 0.005; // Lifted by 5mm to avoid z-fighting flicker
        scene.add(grid);

        // Static Rapier Ground Collider
        const groundBodyDesc = RAPIER.RigidBodyDesc.fixed();
        const groundBody = world.createRigidBody(groundBodyDesc);
        const groundColliderDesc = RAPIER.ColliderDesc.cuboid(
            groundWidth / 2,
            groundThickness / 2,
            groundDepth / 2
        )
            .setTranslation(0, -groundThickness / 2, 0)
            .setRestitution(0.0) // Zero bounce: solid landing
            .setFriction(0.8);   // Realistic road grip
        world.createCollider(groundColliderDesc, groundBody);

        // ----------------------------------------------------
        // 4. LIGHTS & SHADOW CAMERA CONFIGURATION
        // ----------------------------------------------------
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
        // 5. PHASE 2A: CAR PHYSICS (1 RIGIDBODY + 5 COLLIDERS)
        // ----------------------------------------------------
        // A. Dynamic Car Body
        const carBodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(0, 2.0, 0) // Spawn at 2m above ground
            .setLinearDamping(0.5)
            .setAngularDamping(1.0);
        const carBody = world.createRigidBody(carBodyDesc);

        // B. Elevated Chassis Collider (Bottom sits at Y = 0.30m)
        const chassisColliderDesc = RAPIER.ColliderDesc.cuboid(1.8, 0.35, 0.7)
            .setTranslation(0.2, 0.65, 0)
            .setRestitution(0.0)
            .setFriction(0.2);
        world.createCollider(chassisColliderDesc, carBody);

        // C. Four Wheel Colliders (Exact radius 0.312m at model wheel positions)
        const wheelOffsets = [
            { x: -1.037, y: 0.232, z: -0.703 }, // Wheel_BL (Back Left)
            { x: -1.037, y: 0.232, z:  0.700 }, // Wheel_BR (Back Right)
            { x:  1.515, y: 0.232, z: -0.694 }, // Wheel_FL (Front Left)
            { x:  1.515, y: 0.232, z:  0.700 }  // Wheel_FR (Front Right)
        ];

        const WHEEL_RADIUS = 0.312;

        wheelOffsets.forEach(w => {
            const wheelColliderDesc = RAPIER.ColliderDesc.ball(WHEEL_RADIUS)
                .setTranslation(w.x, w.y, w.z)
                .setFriction(1.2)      // High tyre grip
                .setRestitution(0.0);  // Zero bounce: prevents jitter
            world.createCollider(wheelColliderDesc, carBody);
        });

        // ----------------------------------------------------
        // 6. PHASE 2B: LOAD 3D CAR MODEL (/car.glb)
        // ----------------------------------------------------
        let carScene = null;
        const loader = new GLTFLoader();
        loader.load(
            '/car.glb',
            (gltf) => {
                if (!isMounted) return;
                carScene = gltf.scene;

                // Enable shadow casting on all car sub-meshes
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

        // ----------------------------------------------------
        // 7. ANIMATION & PHYSICS STEP LOOP
        // ----------------------------------------------------
        function animate() {
            if (!isMounted) return;
            animationId = requestAnimationFrame(animate);

            try {
                // Step Rapier physics world forward
                world.step();

                // Sync visual Three.js model with Rapier physics transform
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

        // ----------------------------------------------------
        // 8. RESIZE HANDLER
        // ----------------------------------------------------
        function handleResize() {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        }

        window.addEventListener('resize', handleResize);

        // ----------------------------------------------------
        // 9. CLEANUP ON COMPONENT UNMOUNT
        // ----------------------------------------------------
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
```

---

## 5. Troubleshooting: Blank Screen / Kuch Dikhai Na Dena

Agar screen blank (white ya black) dikh rahi hai, toh yeh check karein:

1. **Browser Console Check Karein (F12 Key)**:
   - Browser mein `F12` dabayein ya Right Click $\to$ **Inspect** $\to$ **Console** tab kholiye.
   - Koi laal (red) error message dikh raha hai kya?
2. **`world.free()` Error in StrictMode**:
   - Pehle cleanup function mein `world.free()` likha tha. React StrictMode development mein component ko turant unmount aur remount karta hai. Is wajah se WASM memory release ho jati thi aur `world.step()` crash ho kar screen blank kar deta tha. Upar diye gaye code mein yeh fix kar diya gaya hai.
3. **`removeChild` Error**:
   - Agar container se pehle hi node remove ho chuka ho toh React crash ho jata hai. Ab hum `if (renderer.domElement && renderer.domElement.parentNode)` check karke safely remove karte hain.
4. **Fullscreen Container Style**:
   - `position: 'fixed'`, `top: 0`, `left: 0`, `width: '100vw'`, `height: '100vh'` ensure karta hai ki canvas kisi parent div ke chhota hone ki wajah se hide na ho.
