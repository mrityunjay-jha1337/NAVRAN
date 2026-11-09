"""
Headless Autonomous Driving Training Architecture Package.
"""

import os
import sys

# Ensure train directory is accessible in module search path
_CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if _CURRENT_DIR not in sys.path:
    sys.path.insert(0, _CURRENT_DIR)

from config import ROAD_CONFIG, VEHICLE_CONFIG, REWARD_CONFIG, MODEL_CONFIG, TRAIN_CONFIG
from road_math import get_procedural_road_curve, get_procedural_road_elevation
from target_manager import TargetManager
from car_env import CarDashEnv

__all__ = [
    "ROAD_CONFIG",
    "VEHICLE_CONFIG",
    "REWARD_CONFIG",
    "MODEL_CONFIG",
    "TRAIN_CONFIG",
    "get_procedural_road_curve",
    "get_procedural_road_elevation",
    "TargetManager",
    "CarDashEnv",
]
