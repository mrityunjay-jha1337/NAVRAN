import { useEffect, useRef } from 'react';
import * as THREE from 'three';

function ThreeScene() {
    const mountRef = useRef(null);

    useEffect(() => {
        // 1. Create scene
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x202020);

        // 2. Create camera
        const camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );

        camera.position.set(3, 3, 5);
        camera.lookAt(0, 0, 0);

        // 3. Create renderer
        const renderer = new THREE.WebGLRenderer({ antialias: true });

        renderer.setSize(window.innerWidth, window.innerHeight);
        mountRef.current.appendChild(renderer.domElement);

        // 4. Create box
        const geometry = new THREE.BoxGeometry(1, 1, 1);

        const material = new THREE.MeshStandardMaterial({
            color: 0x00ff88,
            roughness: 0.5,
            metalness: 0.1
        });

        const box = new THREE.Mesh(geometry, material);
        scene.add(box);

        // 5. Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
        directionalLight.position.set(5, 5, 5);
        scene.add(directionalLight);

        // 6. Animation
        let animationId;

        function animate() {
            animationId = requestAnimationFrame(animate);

            box.rotation.x += 0.005;
            box.rotation.y += 0.01;

            renderer.render(scene, camera);
        }

        animate();

        // 7. Resize
        function handleResize() {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();

            renderer.setSize(window.innerWidth, window.innerHeight);
        }

        window.addEventListener('resize', handleResize);

        // 8. Cleanup
        return () => {
            cancelAnimationFrame(animationId);
            window.removeEventListener('resize', handleResize);

            geometry.dispose();
            material.dispose();
            renderer.dispose();

            if (mountRef.current) {
                mountRef.current.removeChild(renderer.domElement);
            }
        };

    }, []);

    return <div ref={mountRef} style={{ width: '100%', height: '100vh' }} />;
}

export default ThreeScene;