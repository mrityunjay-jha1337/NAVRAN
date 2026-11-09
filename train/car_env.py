"""
High-Speed Autonomous Car Driving Gymnasium Environment.
Implements the 30-D Observation Space, 3-Channel Continuous Control,
Vehicle Dynamics, and Multi-Objective Reward Function.
"""

import math
import os
import sys
from typing import Any, Dict, Optional, Tuple

# Ensure train directory is in path
_CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if _CURRENT_DIR not in sys.path:
    sys.path.insert(0, _CURRENT_DIR)

try:
    import numpy as np
except ImportError:
    np = None

try:
    import gymnasium as gym
    from gymnasium import spaces
except ImportError:
    class gym:
        class Env:
            pass
    class spaces:
        class Box:
            def __init__(self, low, high, shape, dtype=None):
                self.low = low
                self.high = high
                self.shape = shape
                self.dtype = dtype
            def sample(self):
                if np is not None:
                    return np.random.uniform(self.low, self.high, size=self.shape).astype(self.dtype)
                return [0.0] * self.shape[0]

from config import ROAD_CONFIG, VEHICLE_CONFIG, REWARD_CONFIG, MODEL_CONFIG
from road_math import (
    get_procedural_road_curve,
    get_procedural_road_elevation,
    compute_ray_distance_to_road_edge,
    get_distance_to_centerline,
)
from target_manager import TargetManager


def _clip(val: float, low: float, high: float) -> float:
    """Clips scalar val between low and high without requiring numpy."""
    return max(low, min(high, val))


class CarDashEnv(gym.Env):
    """
    Gymnasium environment for goal-conditioned autonomous highway navigation.
    
    Actions (3 Continuous Channels in [-1.0, 1.0]):
      - a[0]: Steering (-1.0 = Full Right, +1.0 = Full Left)
      - a[1]: Throttle / Brake (>0 = Acceleration, <0 = Active Braking)
      - a[2]: Shift Nitro Boost (>0.20 triggers nitro acceleration in Stage 2)
      
    Observations (30 Continuous Features in [-1.0, 1.0]):
      - 0..8:   9 Synthetic LiDAR raycasts
      - 9..12:  4 Centerline lateral offsets [5m, 15m, 30m, 55m]
      - 13..16: 4 Road tangent heading deviations
      - 17:     Forward speed (normalized to 45 m/s)
      - 18:     Lateral slip speed (normalized to 15 m/s)
      - 19:     Yaw rate (normalized to 3.0 rad/s)
      - 20:     Current steer angle (normalized to 0.40 rad)
      - 21..23: 3 Road vertical elevation slopes [5m, 15m, 35m]
      - 24:     Framerate delta (0.0 in headless simulation)
      - 25:     Normalized target Euclidean distance [0.0, 1.0]
      - 26:     Target forward offset in car frame [-1.0, 1.0]
      - 27:     Target lateral offset in car frame [-1.0, 1.0]
      - 28:     Target heading angle error [-1.0, 1.0]
      - 29:     Airborne state indicator (0.0 = Grounded, 1.0 = Airborne)
    """

    metadata = {"render_modes": []}

    def __init__(self, curriculum_stage: int = 2):
        super().__init__()
        self.curriculum_stage = curriculum_stage
        self.target_mgr = TargetManager(
            road_width=ROAD_CONFIG.ROAD_WIDTH,
            max_lookahead_dist=ROAD_CONFIG.MAX_LOOKAHEAD_DIST
        )

        # 30-Dimensional Observation Vector bounded to [-1.0, 1.0]
        dtype = np.float32 if np is not None else None
        self.observation_space = spaces.Box(
            low=-1.0, high=1.0, shape=(MODEL_CONFIG.OBS_DIM,), dtype=dtype
        )
        # 3 Continuous Action Channels bounded to [-1.0, 1.0]
        self.action_space = spaces.Box(
            low=-1.0, high=1.0, shape=(MODEL_CONFIG.ACTION_DIM,), dtype=dtype
        )

        # Physical constants
        self.MASS = VEHICLE_CONFIG.MASS
        self.DT = VEHICLE_CONFIG.PHYSICS_DT

        # State variables
        self.pos_x = 0.0
        self.pos_y = 0.0
        self.pos_z = 0.0
        self.yaw = 0.0
        self.vx = 0.0
        self.vz = 0.0
        self.vy = 0.0
        self.yaw_rate = 0.0
        self.steer_angle = 0.0
        self.prev_steer = 0.0
        self.prev_throttle = 0.0
        self.step_count = 0
        self.is_airborne = False
        self.airborne_steps = 0
        self.airborne_steps = 0
        self.seed_val = ROAD_CONFIG.DEFAULT_SEED
        self.target_x = 0.0
        self.target_y = 0.0
        self.target_z = 0.0
        self.prev_target_dist = 0.0

    def reset(
        self,
        seed: Optional[int] = None,
        options: Optional[Dict[str, Any]] = None
    ) -> Tuple[Any, Dict[str, Any]]:
        """Resets the environment state, procedural seed, and target waypoint."""
        import random
        if seed is not None:
            self.seed_val = float(seed)
        else:
            self.seed_val = float(random.randint(1000, 99999))

        self.pos_x = 0.0
        self.pos_y = 0.0
        self.pos_z = 0.0
        self.yaw = 0.0
        self.vx = 0.0
        self.vz = 0.0
        self.vy = 0.0
        self.yaw_rate = 0.0
        self.steer_angle = 0.0
        self.prev_steer = 0.0
        self.prev_throttle = 0.0
        self.step_count = 0
        self.is_airborne = False
        self.airborne_steps = 0

        # Spawn valid forward target on road surface
        self.target_x, self.target_y, self.target_z = self.target_mgr.sample_forward_target(
            self.pos_x, self.seed_val
        )
        _, _, _, _, self.prev_target_dist = self.target_mgr.compute_normalized_target_features(
            self.pos_x, self.pos_y, self.pos_z, self.yaw,
            self.target_x, self.target_y, self.target_z
        )

        return self._get_obs(), {}

    def _get_obs(self) -> Any:
        """Constructs the complete 30-dimensional observation vector."""
        if np is not None:
            obs = np.zeros(MODEL_CONFIG.OBS_DIM, dtype=np.float32)
        else:
            obs = [0.0] * MODEL_CONFIG.OBS_DIM

        # 1. 9 Synthetic LiDAR boundary rays [-75 deg to +75 deg]
        for i, angle_offset in enumerate(ROAD_CONFIG.RAY_ANGLES_RAD):
            ray_heading = self.yaw + angle_offset
            dist = compute_ray_distance_to_road_edge(
                self.pos_x, self.pos_z, ray_heading, self.seed_val,
                road_half_width=ROAD_CONFIG.HALF_WIDTH,
                max_dist=ROAD_CONFIG.LIDAR_MAX_DIST
            )
            obs[i] = dist / ROAD_CONFIG.LIDAR_MAX_DIST

        # 2. 4 Centerline lateral offsets & road tangents
        forward_x = math.cos(self.yaw)
        for i, d in enumerate(ROAD_CONFIG.CENTERLINE_LOOKAHEADS):
            look_x = self.pos_x + forward_x * d
            road_z, road_dz = get_procedural_road_curve(look_x, self.seed_val)
            # Lateral deviation normalized by road half-width (16m)
            obs[9 + i] = _clip((road_z - self.pos_z) / ROAD_CONFIG.HALF_WIDTH, -1.0, 1.0)
            road_tangent_angle = math.atan2(road_dz, 1.0)
            obs[13 + i] = _clip(road_tangent_angle - self.yaw, -1.0, 1.0)

        # 3. Vehicle Telemetry
        obs[17] = _clip(self.vx / 45.0, -1.0, 1.0)
        obs[18] = _clip(self.vz / 15.0, -1.0, 1.0)
        obs[19] = _clip(self.yaw_rate / 3.0, -1.0, 1.0)
        obs[20] = _clip(self.steer_angle / VEHICLE_CONFIG.MAX_STEER_ANGLE, -1.0, 1.0)

        # 4. Elevation Slopes
        obs[21] = (get_procedural_road_elevation(self.pos_x + 5.0, self.seed_val) - self.pos_y) / 5.0
        obs[22] = (get_procedural_road_elevation(self.pos_x + 15.0, self.seed_val) - self.pos_y) / 15.0
        obs[23] = (get_procedural_road_elevation(self.pos_x + 35.0, self.seed_val) - self.pos_y) / 35.0
        obs[24] = 0.0  # Framerate jitter is 0.0 in fixed-step headless simulation

        # 5. Normalized Target Features
        norm_dist, norm_dx, norm_dz, norm_h_err, _ = self.target_mgr.compute_normalized_target_features(
            self.pos_x, self.pos_y, self.pos_z, self.yaw,
            self.target_x, self.target_y, self.target_z
        )
        obs[25] = norm_dist
        obs[26] = norm_dx
        obs[27] = norm_dz
        obs[28] = norm_h_err

        # 6. Airborne state indicator (Neutral in reward, but perceived by agent)
        obs[29] = 1.0 if self.is_airborne else 0.0

        return obs

    def step(self, action: Any) -> Tuple[Any, float, bool, bool, Dict[str, Any]]:
        """Simulates one step of vehicle physics and returns RL transition tuple."""
        self.step_count += 1

        steer_in = float(_clip(action[0], -1.0, 1.0))
        throttle_in = float(_clip(action[1], -1.0, 1.0))
        shift_in = float(action[2]) > VEHICLE_CONFIG.SHIFT_THRESHOLD and (self.curriculum_stage >= 2)

        # 1. Steering Actuation with dynamic rate
        target_steer = steer_in * VEHICLE_CONFIG.MAX_STEER_ANGLE
        self.steer_angle += (target_steer - self.steer_angle) * VEHICLE_CONFIG.STEER_RESPONSE_RATE * self.DT

        # 2. Longitudinal Acceleration & Nitro Boost
        is_boosting = shift_in and (throttle_in > 0.10)
        if throttle_in > 0.0:
            force = VEHICLE_CONFIG.BOOST_ACCEL_FORCE if is_boosting else VEHICLE_CONFIG.NORMAL_ACCEL_FORCE
            speed_cap = VEHICLE_CONFIG.BOOST_MAX_SPEED if is_boosting else VEHICLE_CONFIG.NORMAL_MAX_SPEED
            if self.vx < speed_cap:
                self.vx += (force * throttle_in / self.MASS) * self.DT
        elif throttle_in < 0.0:
            self.vx -= (VEHICLE_CONFIG.BRAKE_FORCE * abs(throttle_in) / self.MASS) * self.DT

        # Prevent reversing beyond -3 m/s
        self.vx = max(self.vx, -3.0)

        # 3. Dynamic Centrifugal Lateral Slip & Grip Limits (Matches Rapier physics)
        # Centripetal acceleration is vx * yaw_rate. If exceeding tire grip (~13.5 m/s^2), excess accelerates lateral slip.
        centrifugal_accel = self.vx * self.yaw_rate
        max_tire_lat_accel = VEHICLE_CONFIG.MAX_TIRE_LAT_ACCEL
        if abs(centrifugal_accel) > max_tire_lat_accel:
            excess_accel = (abs(centrifugal_accel) - max_tire_lat_accel) * math.copysign(1.0, centrifugal_accel)
            self.vz += excess_accel * self.DT * 0.8

        # Lateral grip friction damping
        self.vz *= (1.0 - VEHICLE_CONFIG.LATERAL_GRIP_DAMPING * self.DT * 10.0)

        # 4. Yaw Kinematics
        self.yaw_rate = (self.vx / VEHICLE_CONFIG.WHEELBASE) * math.tan(self.steer_angle)
        self.yaw += self.yaw_rate * self.DT

        # 5. Position Integration
        cos_y = math.cos(self.yaw)
        sin_y = math.sin(self.yaw)
        self.pos_x += (self.vx * cos_y - self.vz * sin_y) * self.DT
        self.pos_z += (self.vx * sin_y + self.vz * cos_y) * self.DT

        # 6. Elevation & Ballistic Airborne Check
        road_surface_y = get_procedural_road_elevation(self.pos_x, self.seed_val)
        elevation_delta = road_surface_y - self.pos_y
        if elevation_delta < -1.2:
            self.is_airborne = True
            self.vy -= 9.81 * self.DT  # Ballistic gravity
            self.pos_y += self.vy * self.DT
        else:
            self.is_airborne = False
            self.pos_y = road_surface_y
            self.vy = 0.0

        # 7. Distance to Centerline (Exact Orthogonal Euclidean Distance)
        d_center, _ = get_distance_to_centerline(self.pos_x, self.pos_z, self.seed_val)

        # 8. Target Distance & Navigation Update
        _, _, _, norm_h_err, curr_target_dist = self.target_mgr.compute_normalized_target_features(
            self.pos_x, self.pos_y, self.pos_z, self.yaw,
            self.target_x, self.target_y, self.target_z
        )

        # -------------------------------------------------------------
        # Multi-Objective Reward Calculation (Highway Path-Corridor + Target Interception)
        # -------------------------------------------------------------
        # A. Road Corridor Forward Progress (ONLY when wheels are on the ground)
        road_z, road_dz = get_procedural_road_curve(self.pos_x, self.seed_val)
        road_tangent = math.atan2(road_dz, 1.0)
        heading_alignment = math.cos(self.yaw - road_tangent)
        
        # Suppress progress & speed if airborne (no free points in the sky!)
        progress_mult = 0.0 if self.is_airborne else 1.0
        r_fwd_prog = REWARD_CONFIG.FORWARD_PROGRESS_WEIGHT * (max(0.0, self.vx) / REWARD_CONFIG.SPEED_NORMALIZER) * max(0.0, heading_alignment) * progress_mult

        # B. Pure Velocity Incentive (Only rewarded when driving within safe road corridor)
        corridor_factor = math.exp(-0.5 * (d_center / 5.0) ** 2)
        r_speed = REWARD_CONFIG.SPEED_WEIGHT * max(0.0, self.vx / REWARD_CONFIG.SPEED_NORMALIZER) * corridor_factor * progress_mult

        # C. Road Staying Reward & Smooth Gaussian Centerline Keeping
        r_road_stay = 0.0
        r_off_road = 0.0
        if d_center <= ROAD_CONFIG.HALF_WIDTH:
            r_road_stay = REWARD_CONFIG.ROAD_STAY_REWARD
            r_center = REWARD_CONFIG.CENTERLINE_WEIGHT * math.exp(-0.5 * (d_center / 3.5) ** 2)
        else:
            r_center = 0.0
            r_off_road = REWARD_CONFIG.OFF_ROAD_BASE_PENALTY + REWARD_CONFIG.OFF_ROAD_PENALTY_SCALE * (d_center - ROAD_CONFIG.HALF_WIDTH)

        # D. Target Heading Guidance (Points directly towards target beacon coordinates)
        r_target_align = REWARD_CONFIG.TARGET_HEADING_WEIGHT * (1.0 - abs(norm_h_err)) if not self.is_airborne else 0.0

        # E. PHYSICAL Checkpoint Coordinate Touch:
        # STRICT REQUIREMENT: Car must physically reach within TARGET_ARRIVAL_RADIUS (5.0m) of the target point
        # AND must be on the ground (NOT airborne!).
        r_reach = 0.0
        is_physical_touch = (curr_target_dist <= REWARD_CONFIG.TARGET_ARRIVAL_RADIUS) and (not self.is_airborne)

        if is_physical_touch:
            r_reach = REWARD_CONFIG.TARGET_ARRIVAL_BONUS
            self.target_x, self.target_y, self.target_z = self.target_mgr.sample_forward_target(
                self.pos_x, self.seed_val
            )
            _, _, _, norm_h_err, curr_target_dist = self.target_mgr.compute_normalized_target_features(
                self.pos_x, self.pos_y, self.pos_z, self.yaw,
                self.target_x, self.target_y, self.target_z
            )
        elif (self.pos_x > self.target_x + 5.0) and (curr_target_dist > REWARD_CONFIG.TARGET_ARRIVAL_RADIUS):
            # Target missed! Penalize and advance to next forward target
            r_reach = REWARD_CONFIG.TARGET_MISS_PENALTY
            self.target_x, self.target_y, self.target_z = self.target_mgr.sample_forward_target(
                self.pos_x, self.seed_val
            )
            _, _, _, norm_h_err, curr_target_dist = self.target_mgr.compute_normalized_target_features(
                self.pos_x, self.pos_y, self.pos_z, self.yaw,
                self.target_x, self.target_y, self.target_z
            )

        # F. Standstill & Reverse Penalty
        r_standstill = REWARD_CONFIG.STANDSTILL_PENALTY if self.vx < 2.0 else 0.0
        r_reverse = REWARD_CONFIG.REVERSE_PENALTY if self.vx < -0.5 else 0.0

        # G. Anti-Spin / Anti-Circle Penalty (Penalizes pointing away from road direction)
        road_heading_error = math.acos(max(-1.0, min(1.0, heading_alignment)))
        r_spin = -10.0 * (road_heading_error / math.pi) if road_heading_error > 0.8 else 0.0

        # H. Airborne Penalty (Heavy punishment for leaving the ground / jumping)
        r_airborne = REWARD_CONFIG.AIRBORNE_PENALTY if self.is_airborne else 0.0

        # I. Tactical Nitro Boost Reward: ONLY when firmly on road tarmac (d_center < 4.0m) and road is straight
        r_boost = 0.0
        if is_boosting:
            if (not self.is_airborne) and (self.vx > 25.0) and (d_center < 4.0) and (abs(norm_h_err) < 0.12):
                r_boost = REWARD_CONFIG.TACTICAL_BOOST_REWARD
            elif self.is_airborne or (d_center > 6.0):
                r_boost = -4.0  # Penalize firing nitro near edge, off-road or in mid-air

        # J. Action Smoothness Penalty (Eliminates Jitter)
        r_jerk = (
            REWARD_CONFIG.STEER_JERK_PENALTY * (steer_in - self.prev_steer) ** 2
            + REWARD_CONFIG.THROTTLE_JERK_PENALTY * (throttle_in - self.prev_throttle) ** 2
        )

        step_reward = float(r_fwd_prog + r_speed + r_road_stay + r_center + r_target_align + r_reach + r_boost + r_standstill + r_reverse + r_spin + r_off_road + r_airborne - r_jerk)

        # Termination & Truncation
        terminated = False
        truncated = self.step_count >= 2000

        # 1. Off-road severe crash termination (Immediate failure if leaving tarmac boundary)
        if d_center > ROAD_CONFIG.CRASH_BOUNDARY_OFFSET:
            terminated = True
            step_reward = REWARD_CONFIG.CRASH_PENALTY

        # 2. Fatal backward spinout termination (facing backwards > 115 degrees)
        if road_heading_error > 2.0:
            terminated = True
            step_reward = REWARD_CONFIG.CRASH_PENALTY

        # 3. Airborne jumping termination: prolonged flight (> 15 steps / 0.25s) is treated as a fatal crash
        if self.is_airborne:
            self.airborne_steps += 1
            if self.airborne_steps > 15:
                terminated = True
                step_reward = REWARD_CONFIG.AIRBORNE_CRASH_PENALTY
        else:
            self.airborne_steps = 0

        # Update previous state cache
        self.prev_steer = steer_in
        self.prev_throttle = throttle_in
        self.prev_target_dist = curr_target_dist

        info = {
            "speed_kmh": self.vx * 3.6,
            "d_center": d_center,
            "is_airborne": self.is_airborne,
            "is_boosting": is_boosting,
            "target_dist": curr_target_dist,
        }

        return self._get_obs(), step_reward, terminated, truncated, info
