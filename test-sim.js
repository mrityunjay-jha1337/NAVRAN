
import RAPIER from '@dimforge/rapier3d';

const gravity = { x: 0.0, y: -10, z: 0.0 };
const world = new RAPIER.World(gravity);

const groundWidth = 50;
const groundThickness = 1;
const groundDepth = 50;

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

const carBodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(0, 2.0, 0)
    .setLinearDamping(0.5)
    .setAngularDamping(1.0);
const carBody = world.createRigidBody(carBodyDesc);

const chassisColliderDesc = RAPIER.ColliderDesc.cuboid(1.8, 0.35, 0.7)
    .setTranslation(0.2, 0.65, 0)
    .setRestitution(0.0)
    .setFriction(0.2);
world.createCollider(chassisColliderDesc, carBody);

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

console.log('Initial translation:', carBody.translation());

for (let i = 0; i < 300; i++) {
    world.step();
}

console.log('Settled translation:', carBody.translation());
console.log('Settled rotation:', carBody.rotation());
