import * as THREE from 'three';

/**
 * Creates a glowing holographic 3D target beacon at road target coordinates.
 * Features a vertical luminous beam and an oscillating ground ring.
 */
export function createTargetBeacon() {
    const group = new THREE.Group();

    // 1. Glowing vertical light beacon cylinder
    const beamGeo = new THREE.CylinderGeometry(0.8, 0.8, 24.0, 16);
    const beamMat = new THREE.MeshBasicMaterial({
        color: 0x00ffcc,
        transparent: true,
        opacity: 0.45,
        wireframe: true,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = 12.0;
    group.add(beam);

    // 2. Core bright beam
    const coreGeo = new THREE.CylinderGeometry(0.25, 0.25, 24.0, 8);
    const coreMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.75,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.y = 12.0;
    group.add(core);

    // 3. Pulsing target ground ring
    const ringGeo = new THREE.RingGeometry(1.5, 3.5, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0x00ffcc,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.2;
    group.add(ring);

    // 4. Outer dashed beacon ring
    const outerRingGeo = new THREE.RingGeometry(4.0, 4.5, 24);
    outerRingGeo.rotateX(-Math.PI / 2);
    const outerRingMat = new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.4,
        wireframe: true,
    });
    const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
    outerRing.position.y = 0.15;
    group.add(outerRing);

    let animationTime = 0.0;

    return {
        mesh: group,
        updatePosition(x, y, z) {
            group.position.set(x, y, z);
        },
        triggerHit() {
            // Rapid celebratory touch explosion
            ringMat.color.setHex(0xffe600);
            beamMat.color.setHex(0xffaa00);
            ring.scale.set(2.2, 2.2, 1.0);
            setTimeout(() => {
                ringMat.color.setHex(0x00ffcc);
                beamMat.color.setHex(0x00ffcc);
            }, 350);
        },
        animate(delta) {
            animationTime += delta;
            // Pulsing scale and breathing opacity
            const scale = 1.0 + Math.sin(animationTime * 4.0) * 0.15;
            ring.scale.set(scale, scale, 1.0);
            outerRing.rotation.z += delta * 0.5;
            beam.rotation.y += delta * 0.8;
            beamMat.opacity = 0.35 + Math.sin(animationTime * 3.0) * 0.15;
        },
        dispose() {
            beamGeo.dispose();
            beamMat.dispose();
            coreGeo.dispose();
            coreMat.dispose();
            ringGeo.dispose();
            ringMat.dispose();
            outerRingGeo.dispose();
            outerRingMat.dispose();
        }
    };
}
