"""
Goal-Conditioned Target Management and Road Surface Projection.
Ensures that arbitrary targets (including off-road coordinates) are mathematically
projected onto the valid tarmac surface and normalized for the RL policy.
"""

import math
import os
import random
import sys
from typing import Tuple

# Ensure train directory is in path
_CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if _CURRENT_DIR not in sys.path:
    sys.path.insert(0, _CURRENT_DIR)

from road_math import get_procedural_road_curve, get_procedural_road_elevation, get_distance_to_centerline
from config import ROAD_CONFIG


class TargetManager:
    """
    Manages goal generation, orthogonal road boundary projection via Newton-Raphson,
    and vehicle-relative coordinate normalization.
    """

    def __init__(
        self,
        road_width: float = ROAD_CONFIG.ROAD_WIDTH,
        max_lookahead_dist: float = ROAD_CONFIG.MAX_LOOKAHEAD_DIST
    ):
        self.road_width = road_width
        self.half_width = road_width * 0.5
        self.max_lookahead_dist = max_lookahead_dist

    def project_to_nearest_road_point(self, raw_x: float, raw_z: float, seed: float) -> Tuple[float, float, float]:
        """
        Projects an arbitrary 2D target coordinate (raw_x, raw_z) to the nearest valid point 
        on the 3D road surface using Newton-Raphson curve projection and lateral clamping.
        
        Returns:
            (projected_x, projected_y, projected_z)
        """
        # 1. Newton-Raphson solve for closest centerline parameter t
        t = float(raw_x)
        for _ in range(3):
            rc_z, rc_dz = get_procedural_road_curve(t, seed)
            f = (t - raw_x) + (rc_z - raw_z) * rc_dz
            f_prime = 1.0 + rc_dz * rc_dz
            delta = f / f_prime
            t -= delta
            if abs(delta) < 0.005:
                break

        road_z, road_dz = get_procedural_road_curve(t, seed)

        # 2. Compute orthogonal unit normal vector to road centerline
        length = math.hypot(1.0, road_dz)
        norm_x = -road_dz / length
        norm_z = 1.0 / length

        # 3. Signed lateral displacement from centerline
        disp_x = raw_x - t
        disp_z = raw_z - road_z
        lateral_offset = disp_x * norm_x + disp_z * norm_z

        # 4. Check if point is outside comfortable corridor (lateral distance > half_width * 0.75)
        corridor_limit = self.half_width * 0.75
        if abs(lateral_offset) > corridor_limit:
            clamped_offset = (1.0 if lateral_offset > 0 else -1.0) * corridor_limit
            target_x = t + clamped_offset * norm_x
            target_z = road_z + clamped_offset * norm_z
        else:
            target_x = raw_x
            target_z = raw_z

        target_y = get_procedural_road_elevation(target_x, seed)
        return float(target_x), float(target_y), float(target_z)

    def sample_forward_target(
        self,
        car_x: float,
        seed: float,
        min_dist: float = 50.0,
        max_dist: float = 130.0
    ) -> Tuple[float, float, float]:
        """
        Generates a forward waypoint along the road corridor.
        Samples within drivable corridor (+-8.5m) matching three.jsx.
        """
        dist = random.uniform(min_dist, max_dist)
        target_x = car_x + dist
        road_z, _ = get_procedural_road_curve(target_x, seed)

        lateral_jitter = random.uniform(-8.5, 8.5)
        raw_z = road_z + lateral_jitter

        return self.project_to_nearest_road_point(target_x, raw_z, seed)

    def compute_normalized_target_features(
        self,
        car_x: float,
        car_y: float,
        car_z: float,
        car_yaw: float,
        target_x: float,
        target_y: float,
        target_z: float
    ) -> Tuple[float, float, float, float, float]:
        """
        Transforms and normalizes target vector into the vehicle's local frame.
        
        Returns:
            (norm_dist, norm_local_dx, norm_local_dz, norm_heading_error, euclidean_dist)
        """
        dx = target_x - car_x
        dz = target_z - car_z
        dist = math.hypot(dx, dz)
        norm_dist = min(max(dist / self.max_lookahead_dist, 0.0), 1.0)

        # Rotate displacement into car local reference frame
        cos_yaw = math.cos(car_yaw)
        sin_yaw = math.sin(car_yaw)
        local_dx = dx * cos_yaw + dz * sin_yaw
        local_dz = -dx * sin_yaw + dz * cos_yaw

        norm_local_dx = min(max(local_dx / self.max_lookahead_dist, -1.0), 1.0)
        norm_local_dz = min(max(local_dz / self.half_width, -1.0), 1.0)

        # Heading error to target: atan2(local_dz, local_dx) / pi in [-1.0, 1.0]
        target_angle = math.atan2(local_dz, local_dx)
        norm_heading_error = target_angle / math.pi

        return float(norm_dist), float(norm_local_dx), float(norm_local_dz), float(norm_heading_error), float(dist)
