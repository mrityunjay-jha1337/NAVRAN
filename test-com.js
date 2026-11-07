
import RAPIER from '@dimforge/rapier3d';

const gravity = { x: 0.0, y: 0.0, z: 0.0 };
const world = new RAPIER.World(gravity);

const carBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 2.0, 0);
const carBody = world.createRigidBody(carBodyDesc);

console.log('Before colliders:');
console.log('translation:', carBody.translation());
console.log('centerOfMass:', carBody.centerOfMass());

const chassisColliderDesc = RAPIER.ColliderDesc.cuboid(1.8, 0.35, 0.7).setTranslation(0.2, 0.65, 0);
world.createCollider(chassisColliderDesc, carBody);

console.log('After collider:');
console.log('translation:', carBody.translation());
console.log('centerOfMass:', carBody.centerOfMass());
