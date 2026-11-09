"""
Infinite Procedural Road Mathematical Foundations.
Bit-for-bit analytical port of Road.js to Python.
Features Dave Hoskins 1D Hash and Quintic Hermite C2 Interpolation.
"""

import math
import os
import sys
from typing import Tuple

# Ensure train directory is in path
_CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if _CURRENT_DIR not in sys.path:
    sys.path.insert(0, _CURRENT_DIR)


def fract(x: float) -> float:
    """Fractional part of floating point scalar: x - floor(x)."""
    return x - math.floor(x)


def hash1(p: float, seed: float = 1337.0) -> float:
    """
    Dave Hoskins 1D Hash function.
    Deterministic pseudo-random value in range [-1.0, 1.0].
    """
    p3 = fract((p + seed * 0.13371) * 0.1031)
    p3 += p3 * (p3 + 33.33)
    return fract(p3 * 43758.5453) * 2.0 - 1.0


def grad_noise_1d(x: float, seed: float = 1337.0) -> Tuple[float, float]:
    """
    1D Gradient Noise with Quintic Hermite C2 continuous interpolation
    and analytical first derivative.
    
    Returns:
        (value, derivative)
    """
    i = math.floor(x)
    f = x - i

    # Quintic Hermite curve: u(f) = 6f^5 - 15f^4 + 10f^3
    u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0)
    # Derivative: u'(f) = 30f^4 - 60f^3 + 30f^2 = 30f^2(1 - f)^2
    du = 30.0 * f * f * (f * (f - 2.0) + 1.0)

    g0 = hash1(i, seed)
    g1 = hash1(i + 1.0, seed)

    d0 = g0 * f
    d1 = g1 * (f - 1.0)

    val = d0 + u * (d1 - d0)
    deriv = g0 + u * (g1 - g0) + du * (d1 - d0)

    return val, deriv


def get_procedural_road_curve(x: float, seed: float = 1170.0) -> Tuple[float, float]:
    """
    Returns the lateral road displacement Z and derivative dZ/dX at any coordinate X.
    Matches Road.js getProceduralRoadCurve.
    
    Returns:
        (z, dz_dx)
    """
    n1_val, n1_deriv = grad_noise_1d(x / 280.0, seed + 10.0)
    n2_val, n2_deriv = grad_noise_1d(x / 130.0, seed + 20.0)
    n3_val, n3_deriv = grad_noise_1d(x / 65.0, seed + 30.0)

    z = n1_val * 240.0 + n2_val * 90.0 + n3_val * 25.0
    dz = (n1_deriv * 240.0) / 280.0 + (n2_deriv * 90.0) / 130.0 + (n3_deriv * 25.0) / 65.0

    # Smooth level straight section around spawn point (|x| < 40m)
    ax = abs(x)
    if ax < 40.0:
        return 0.0, 0.0
    elif ax < 90.0:
        f = (ax - 40.0) / 50.0
        u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0)
        du = ((30.0 * f * f * (f * (f - 2.0) + 1.0)) / 50.0) * (-1.0 if x < 0.0 else 1.0)
        dz = z * du + dz * u
        z = z * u

    return float(z), float(dz)


def get_procedural_road_elevation(x: float, seed: float = 1170.0, elevation_scale: float = 1.0) -> float:
    """
    Returns the road vertical elevation Y at coordinate X in infinite space.
    Matches Road.js getProceduralRoadElevation.
    
    Returns:
        elevation_y
    """
    e1_val, _ = grad_noise_1d(x / 320.0, seed + 50.0)
    e2_val, _ = grad_noise_1d(x / 140.0, seed + 60.0)

    y = (e1_val * 75.0 + e2_val * 35.0) * elevation_scale

    ax = abs(x)
    if ax < 40.0:
        return 0.0
    elif ax < 90.0:
        f = (ax - 40.0) / 50.0
        u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0)
        y *= u

    return float(y)


def compute_ray_distance_to_road_edge(
    pos_x: float, pos_z: float, ray_heading: float, seed: float, road_half_width: float = 16.0, max_dist: float = 60.0
) -> float:
    """
    Simulates a horizontal LiDAR raycast from (pos_x, pos_z) in direction ray_heading,
    detecting the distance to the outer tarmac edge (where lateral offset > road_half_width).
    """
    cos_h = math.cos(ray_heading)
    sin_h = math.sin(ray_heading)
    num_samples = 30
    step_size = max_dist / num_samples

    for step in range(1, num_samples + 1):
        dist = step * step_size
        sample_x = pos_x + cos_h * dist
        sample_z = pos_z + sin_h * dist
        road_z, _ = get_procedural_road_curve(sample_x, seed)
        if abs(sample_z - road_z) > road_half_width:
            return float(dist)

    return float(max_dist)


def get_distance_to_centerline(x: float, z: float, seed: float) -> Tuple[float, float]:
    """
    Calculates the exact orthogonal Euclidean distance from any (x, z) coordinate
    to the procedural road centerline curve using Newton-Raphson refinement.
    
    Returns:
        (orthogonal_distance, closest_t)
    """
    t = float(x)
    for _ in range(4):
        rc_z, rc_dz = get_procedural_road_curve(t, seed)
        f = (t - x) + (rc_z - z) * rc_dz
        f_prime = 1.0 + rc_dz * rc_dz
        t -= f / f_prime

    rc_z, _ = get_procedural_road_curve(t, seed)
    dist = math.hypot(t - x, rc_z - z)
    return float(dist), float(t)

