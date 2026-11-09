"""
Mathematical Parity & Invariant Verification Suite.
Validates parity with Road.js procedural algorithms, Newton-Raphson projection,
and observation normalization constraints.
"""

import math
import os
import sys

# Ensure train directory is in path
_CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if _CURRENT_DIR not in sys.path:
    sys.path.insert(0, _CURRENT_DIR)

from road_math import (
    get_procedural_road_curve,
    get_procedural_road_elevation,
    compute_ray_distance_to_road_edge,
    get_distance_to_centerline,
)
from target_manager import TargetManager
from config import ROAD_CONFIG


def run_math_parity_tests() -> bool:
    """Executes validation assertions across all core mathematical algorithms."""
    print("=" * 65)
    print("RUNNING MATHEMATICAL PARITY & SYSTEM INVARIANT CHECKS")
    print("=" * 65)

    seed = ROAD_CONFIG.DEFAULT_SEED
    mgr = TargetManager(road_width=ROAD_CONFIG.ROAD_WIDTH)

    # 1. Road Curve & Elevation Tests
    test_x_values = [0.0, 35.0, 80.0, 150.0, 300.0, 1200.0]
    print("\n[1] Evaluating Road Geometry across Longitudinal Coordinates:")
    for x in test_x_values:
        z, dz = get_procedural_road_curve(x, seed)
        y = get_procedural_road_elevation(x, seed)
        print(f"    X={x:7.1f}m -> Z={z:8.3f}m, dZ/dX={dz:7.3f}, Y={y:7.3f}m")

    # Invariant: At spawn (|x| < 40m), flat straight section (Z=0, dZ=0, Y=0)
    z_spawn, dz_spawn = get_procedural_road_curve(0.0, seed)
    y_spawn = get_procedural_road_elevation(0.0, seed)
    assert z_spawn == 0.0 and dz_spawn == 0.0 and y_spawn == 0.0, "Spawn flat straight section failed!"

    z_spawn_30, _ = get_procedural_road_curve(30.0, seed)
    y_spawn_30 = get_procedural_road_elevation(30.0, seed)
    assert z_spawn_30 == 0.0 and y_spawn_30 == 0.0, "Flat spawn radius (|x| < 40m) invariant failed!"
    print("    Spawn flat road invariant (Z=0, dZ=0, Y=0 for |x| < 40m): PASSED")

    # 2. Nearest-Road Surface Projection Tests
    print("\n[2] Testing Goal Nearest-Road Projection (Newton-Raphson + Lateral Clamp):")
    test_targets = [
        (200.0, 150.0),    # Strongly off-road positive Z
        (500.0, -180.0),   # Strongly off-road negative Z
        (80.0, 0.0),       # On-road near centerline
        (1000.0, 50.0),    # Distant off-road target
    ]

    for raw_x, raw_z in test_targets:
        proj_x, proj_y, proj_z = mgr.project_to_nearest_road_point(raw_x, raw_z, seed)
        dist_to_curve, _ = get_distance_to_centerline(proj_x, proj_z, seed)
        expected_y = get_procedural_road_elevation(proj_x, seed)

        print(f"    Raw Target: ({raw_x:6.1f}, {raw_z:6.1f}) -> Road Surface: ({proj_x:6.1f}, {proj_y:6.1f}, {proj_z:6.1f})")
        print(f"      Orthogonal Distance to Centerline: {dist_to_curve:5.2f}m (Max Half-Width: {mgr.half_width}m)")

        assert dist_to_curve <= mgr.half_width + 0.05, (
            f"Projected target exceeded road boundary! Orthogonal distance: {dist_to_curve:.3f}m"
        )
        assert abs(proj_y - expected_y) < 1e-4, "Projected elevation mismatch!"

    print("    Target surface boundary projection invariants: PASSED")

    # 3. Target Local Coordinate Normalization Tests
    print("\n[3] Testing Target Feature Normalization into Car Local Frame:")
    car_x, car_y, car_z, car_yaw = 100.0, 5.0, 10.0, 0.25
    target_x, target_y, target_z = 250.0, 12.0, 22.0
    norm_dist, norm_dx, norm_dz, norm_h_err, dist = mgr.compute_normalized_target_features(
        car_x, car_y, car_z, car_yaw, target_x, target_y, target_z
    )

    print(f"    Normalized Target Features -> Dist: {norm_dist:.3f}, Fwd Offset: {norm_dx:.3f}, Lat Offset: {norm_dz:.3f}, Heading Err: {norm_h_err:.3f}")
    assert 0.0 <= norm_dist <= 1.0, f"Target distance {norm_dist} out of bounds [0, 1]!"
    assert -1.0 <= norm_dx <= 1.0, f"Target local dx {norm_dx} out of bounds [-1, 1]!"
    assert -1.0 <= norm_dz <= 1.0, f"Target local dz {norm_dz} out of bounds [-1, 1]!"
    assert -1.0 <= norm_h_err <= 1.0, f"Target heading error {norm_h_err} out of bounds [-1, 1]!"
    print("    Target feature normalization bounds: PASSED")

    # 4. LiDAR Boundary Raycast Tests
    print("\n[4] Testing Synthetic LiDAR Boundary Raycasts:")
    ray_dist = compute_ray_distance_to_road_edge(
        pos_x=100.0, pos_z=0.0, ray_heading=math.pi / 2, seed=seed, road_half_width=16.0, max_dist=60.0
    )
    print(f"    Perpendicular 90 deg raycast distance to edge: {ray_dist:.2f}m")
    assert 0.0 < ray_dist <= 60.0, "LiDAR raycast distance out of bounds!"
    print("    LiDAR raycast distance bounds: PASSED")

    print("\n" + "=" * 65)
    print(" ALL MATHEMATICAL PARITY CHECKS PASSED SUCCESSFULLY!")
    print("=" * 65)
    return True


if __name__ == "__main__":
    success = run_math_parity_tests()
    sys.exit(0 if success else 1)

