"""
Configuration and Hyperparameter Specification for Autonomous Car Driving RL Agent.
Hardware Target: NVIDIA GeForce RTX 2050 (4 GB GDDR6) + 16 GB System RAM.
Matches Three.js & Rapier3D physics in browser environment.
"""

from dataclasses import dataclass, field
from typing import List, Tuple
import os


@dataclass(frozen=True)
class RoadConfig:
    """Analytical Road Geometry Constants."""
    ROAD_WIDTH: float = 32.0
    HALF_WIDTH: float = 16.0
    CRASH_BOUNDARY_OFFSET: float = 22.0   # Generous recovery margin outside tarmac
    DEFAULT_SEED: float = 1170.0
    MAX_LOOKAHEAD_DIST: float = 300.0
    RAY_ANGLES_RAD: Tuple[float, ...] = (
        -1.309,  # -75 deg
        -0.785,  # -45 deg
        -0.523,  # -30 deg
        -0.261,  # -15 deg
         0.0,    #   0 deg
         0.261,  # +15 deg
         0.523,  # +30 deg
         0.785,  # +45 deg
         1.309,  # +75 deg
    )
    CENTERLINE_LOOKAHEADS: Tuple[float, ...] = (5.0, 15.0, 30.0, 55.0)
    ELEVATION_LOOKAHEADS: Tuple[float, ...] = (5.0, 15.0, 35.0)
    LIDAR_MAX_DIST: float = 60.0


@dataclass(frozen=True)
class VehicleConfig:
    """Vehicle Dynamics Constants matching Rapier3D vehicle in three.jsx."""
    MASS: float = 1500.0                    # Vehicle mass (kg)
    NORMAL_MAX_SPEED: float = 40.0          # Normal top speed (m/s) ~144 km/h
    BOOST_MAX_SPEED: float = 100.0          # Shift Nitro top speed (m/s) ~360 km/h
    NORMAL_ACCEL_FORCE: float = 1500.0 * 18.0  # 27,000 N
    BOOST_ACCEL_FORCE: float = 1500.0 * 40.0   # 60,000 N (~2.22x boost)
    BRAKE_FORCE: float = 1500.0 * 30.0         # 45,000 N
    MAX_STEER_ANGLE: float = 0.40           # ~23 degrees in radians
    STEER_RESPONSE_RATE: float = 12.0       # Steering smoothing factor
    WHEELBASE: float = 2.55                 # Wheelbase length (meters)
    LATERAL_GRIP_DAMPING: float = 0.85      # Lateral tire slip dampening
    PHYSICS_DT: float = 1.0 / 60.0          # 60 Hz simulation time-step
    SHIFT_THRESHOLD: float = 0.20           # Action[2] > 0.20 triggers nitro boost


@dataclass(frozen=True)
class RewardConfig:
    """Robust Highway Path-Following & Target Interception Reward Formulation."""
    FORWARD_PROGRESS_WEIGHT: float = 3.5    # Continuous longitudinal progress along road corridor
    SPEED_WEIGHT: float = 2.0               # Positive reward for maintaining high forward velocity
    SPEED_NORMALIZER: float = 45.0          # 45 m/s (~162 km/h) normalizer
    CENTERLINE_WEIGHT: float = 2.0          # Smooth Gaussian centerline keeping
    TARGET_HEADING_WEIGHT: float = 1.5      # Guidance alignment towards target beacon
    TARGET_ARRIVAL_BONUS: float = 50.0      # Dense payout for hitting target
    TARGET_ARRIVAL_RADIUS: float = 8.0      # Arrival radius threshold (meters)
    OFF_ROAD_PENALTY_SCALE: float = -4.0    # Penalty per meter outside tarmac boundary
    STANDSTILL_PENALTY: float = -0.5        # Active penalty for standing still (ELIMINATES LAZY CAMPING)
    REVERSE_PENALTY: float = -2.0           # Penalty for driving backwards
    AIRBORNE_REWARD: float = 0.0            # Airborne state is strictly neutral (0.0)
    TACTICAL_BOOST_REWARD: float = 2.0      # Nitro boost on straight road corridors
    STEER_JERK_PENALTY: float = 0.05        # Smooth steering (dSteer^2)
    THROTTLE_JERK_PENALTY: float = 0.02     # Smooth throttle (dThrottle^2)
    CRASH_PENALTY: float = -50.0            # Severe off-road crash penalty


@dataclass(frozen=True)
class ModelConfig:
    """Twin Actor-Critic MLP Architecture Constants."""
    OBS_DIM: int = 30
    ACTION_DIM: int = 3
    ACTOR_LAYERS: Tuple[int, ...] = (128, 128, 64)
    CRITIC_LAYERS: Tuple[int, ...] = (128, 128, 64)
    USE_LAYER_NORM: bool = True
    ACTIVATION: str = "ELU"


@dataclass(frozen=True)
class TrainingConfig:
    """PPO Vectorized Multi-Worker Hyperparameters."""
    NUM_WORKERS: int = 8                    # 8 parallel CPU simulation environments
    N_STEPS: int = 512                      # Rollout steps per env (total batch = 4,096)
    BATCH_SIZE: int = 128                   # Mini-batch size optimized for RTX 2050 GDDR6
    N_EPOCHS: int = 8                       # PPO optimization epochs per rollout
    LEARNING_RATE: float = 3e-4             # Adam learning rate
    GAMMA: float = 0.995                    # Discount factor
    GAE_LAMBDA: float = 0.95                # GAE lambda
    CLIP_RANGE: float = 0.20                # PPO clip ratio
    ENT_COEF: float = 0.005                 # Entropy coefficient for exploration
    VF_COEF: float = 0.50                   # Value function loss coefficient
    MAX_GRAD_NORM: float = 0.50             # Gradient clipping threshold
    TOTAL_TIMESTEPS: int = 2_000_000        # Stage 1 + Stage 2 total steps
    STAGE_1_TIMESTEPS: int = 400_000        # Centering & basic speed
    MAX_EPISODE_STEPS: int = 2000           # Episode truncation threshold

    # File Paths
    CHECKPOINT_DIR: str = os.path.join(os.path.dirname(__file__), "checkpoints")
    TENSORBOARD_DIR: str = os.path.join(os.path.dirname(__file__), "tensorboard_logs")
    FINAL_MODEL_PATH: str = os.path.join(os.path.dirname(__file__), "checkpoints", "car_agent_final")
    ONNX_OUTPUT_PATH: str = os.path.join(os.path.dirname(__file__), "..", "public", "models", "car_agent.onnx")


ROAD_CONFIG = RoadConfig()
VEHICLE_CONFIG = VehicleConfig()
REWARD_CONFIG = RewardConfig()
MODEL_CONFIG = ModelConfig()
TRAIN_CONFIG = TrainingConfig()
