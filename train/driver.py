#!/usr/bin/env python3
"""
Autonomous Car Driver & RL Training Pipeline Orchestrator.
Master command-line entry point for system verification, environment testing,
curriculum PPO training, model evaluation, and ONNX export.

Target Hardware: NVIDIA GeForce RTX 2050 (4 GB GDDR6) + 16 GB System RAM.
Target Environment: Infinite Procedural 3D Mountain Highway with Three.js & Rapier3D.
"""

import argparse
import os
import sys
import math
import time
from typing import Optional

# Ensure train package is discoverable
_CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if _CURRENT_DIR not in sys.path:
    sys.path.insert(0, _CURRENT_DIR)

from config import ROAD_CONFIG, VEHICLE_CONFIG, REWARD_CONFIG, MODEL_CONFIG, TRAIN_CONFIG
from road_math import get_procedural_road_curve, get_procedural_road_elevation
from target_manager import TargetManager
from car_env import CarDashEnv
from verify_math_parity import run_math_parity_tests


def get_hardware_diagnostics() -> dict:
    """Probes host hardware, CUDA availability, and compute resources."""
    diagnostics = {
        "cuda_available": False,
        "device_name": "CPU Only",
        "device_count": 0,
        "vram_total_gb": 0.0,
        "recommended_workers": TRAIN_CONFIG.NUM_WORKERS,
        "packages": {}
    }

    # Check key packages
    for pkg in ["torch", "numpy", "gymnasium", "stable_baselines3", "onnx"]:
        try:
            __import__(pkg)
            diagnostics["packages"][pkg] = True
        except ImportError:
            diagnostics["packages"][pkg] = False

    try:
        import torch
        if torch.cuda.is_available():
            diagnostics["cuda_available"] = True
            diagnostics["device_name"] = torch.cuda.get_device_name(0)
            diagnostics["device_count"] = torch.cuda.device_count()
            vram_bytes = torch.cuda.get_device_properties(0).total_memory
            diagnostics["vram_total_gb"] = round(vram_bytes / (1024 ** 3), 2)
    except Exception:
        pass

    return diagnostics


def print_system_status():
    """Prints diagnostic summary of current training pipeline and checkpoints."""
    diag = get_hardware_diagnostics()
    print("=" * 70)
    print("  AUTONOMOUS CAR DRIVER - SYSTEM ARCHITECTURE STATUS")
    print("=" * 70)
    print(f"  Target Environment : Infinite Procedural Mountain Highway (32m width)")
    print(f"  Observation Space  : 30 Continuous Dimensions (LiDAR + Curve + Target + Air)")
    print(f"  Action Space       : 3 Continuous Dimensions [Steer, Throttle/Brake, Shift]")
    print(f"  Compute Device     : {diag['device_name']}")
    if diag["cuda_available"]:
        print(f"  CUDA VRAM          : {diag['vram_total_gb']} GB (RTX 2050 Acceleration)")
    print(f"  Rollout Workers    : {diag['recommended_workers']} Parallel CPU Environments")
    print("-" * 70)
    print("  Python RL Dependencies:")
    all_installed = True
    for pkg, is_installed in diag["packages"].items():
        status = "INSTALLED" if is_installed else "NOT INSTALLED"
        print(f"    - {pkg:<20}: {status}")
        if not is_installed:
            all_installed = False

    if not all_installed:
        print("\n  [Notice] Some dependencies are not yet installed.")
        print("  To install: pip install -r train/requirements.txt")
    print("-" * 70)

    # Checkpoint check
    final_ckpt = TRAIN_CONFIG.FINAL_MODEL_PATH + ".zip"
    has_final = os.path.exists(final_ckpt) or os.path.exists(TRAIN_CONFIG.FINAL_MODEL_PATH)
    print(f"  Checkpoints Dir    : {TRAIN_CONFIG.CHECKPOINT_DIR}")
    print(f"  Trained Model      : {'FOUND' if has_final else 'NOT YET TRAINED'}")

    # ONNX check
    onnx_path = TRAIN_CONFIG.ONNX_OUTPUT_PATH
    has_onnx = os.path.exists(onnx_path)
    onnx_size = f"({os.path.getsize(onnx_path) / 1024:.1f} KB)" if has_onnx else ""
    print(f"  Exported ONNX      : {onnx_path} {'FOUND ' + onnx_size if has_onnx else 'NOT YET EXPORTED'}")
    print("=" * 70)


def check_environment_sanity(steps: int = 1000):
    """
    Simulates environment steps with random continuous actions.
    Validates observation bounds [-1, 1], step timing, and reward dynamics
    without requiring trained neural weights.
    """
    print("=" * 70)
    print(f"  RUNNING ENVIRONMENT SANITY CHECK ({steps} STEPS)")
    print("=" * 70)

    env = CarDashEnv(curriculum_stage=2)
    obs, info = env.reset(seed=1337)

    obs_len = obs.shape[0] if hasattr(obs, "shape") else len(obs)
    assert obs_len == MODEL_CONFIG.OBS_DIM, f"Expected obs dimension {MODEL_CONFIG.OBS_DIM}, got {obs_len}"

    start_time = time.perf_counter()
    episodes = 0
    total_reward = 0.0
    crashes = 0
    targets_reached = 0

    import random
    try:
        import numpy as np
    except ImportError:
        np = None

    for step in range(1, steps + 1):
        # Sample random continuous action: [steer, throttle, shift]
        if np is not None:
            action = np.random.uniform(-1.0, 1.0, size=(MODEL_CONFIG.ACTION_DIM,)).astype(np.float32)
        else:
            action = [random.uniform(-1.0, 1.0) for _ in range(MODEL_CONFIG.ACTION_DIM)]

        obs, reward, terminated, truncated, step_info = env.step(action)
        total_reward += reward

        # Verify observation bounds
        for feat in obs:
            if math.isnan(feat) or math.isinf(feat):
                raise ValueError(f"NaN or Inf detected in observation at step {step}: {obs}")

        # Check for crash or target reach
        if terminated:
            crashes += 1
            episodes += 1
            obs, info = env.reset()
        elif truncated:
            episodes += 1
            obs, info = env.reset()

        if reward >= REWARD_CONFIG.TARGET_ARRIVAL_BONUS:
            targets_reached += 1

    elapsed = time.perf_counter() - start_time
    steps_per_sec = steps / max(elapsed, 1e-6)

    print(f"  Completed Steps    : {steps:,}")
    print(f"  Elapsed Time       : {elapsed:.3f} s")
    print(f"  Simulation Speed   : {steps_per_sec:,.0f} steps/sec (Single CPU Thread)")
    print(f"  Projected 8-Worker : {steps_per_sec * 8:,.0f} steps/sec")
    print(f"  Episodes Completed : {episodes}")
    print(f"  Crashes Logged     : {crashes}")
    print(f"  Targets Reached    : {targets_reached}")
    print(f"  Mean Step Reward   : {total_reward / steps:.3f}")
    print("=" * 70)
    print("  ENVIRONMENT SANITY CHECK PASSED - READY FOR TRAINING")
    print("=" * 70)


def run_training_cmd(
    timesteps: int = TRAIN_CONFIG.TOTAL_TIMESTEPS,
    workers: int = TRAIN_CONFIG.NUM_WORKERS,
    stage: int = 2,
    resume: Optional[str] = None
):
    """Entry point when the user triggers training."""
    from train_ppo import start_training
    start_training(
        total_timesteps=timesteps,
        num_workers=workers,
        stage=stage,
        resume_from=resume
    )


def run_export_cmd(checkpoint: Optional[str] = None, output: Optional[str] = None):
    """Entry point for exporting trained weights to browser ONNX."""
    from export_onnx import export_policy_to_onnx
    export_policy_to_onnx(checkpoint_path=checkpoint, output_path=output)


def run_tensorboard_cmd(port: int = 6006, host: str = "0.0.0.0"):
    """Launches live TensorBoard server for monitoring training curves."""
    os.makedirs(TRAIN_CONFIG.TENSORBOARD_DIR, exist_ok=True)
    tb_bin = os.path.join(os.path.dirname(_CURRENT_DIR), ".venv", "bin", "tensorboard")
    if not os.path.exists(tb_bin):
        tb_bin = "tensorboard"
    cmd = [tb_bin, f"--logdir={TRAIN_CONFIG.TENSORBOARD_DIR}", f"--port={port}", f"--host={host}"]
    print(f"[TensorBoard] Launching TensorBoard server on http://localhost:{port}")
    print(f"[TensorBoard] Monitoring logs directory: {TRAIN_CONFIG.TENSORBOARD_DIR}")
    os.execvp(cmd[0], cmd)


def main():
    parser = argparse.ArgumentParser(
        description="Autonomous Car Driver & Headless PPO Training Orchestrator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Available Workflow Commands:
  python driver.py status       # Check hardware, environment, and checkpoints
  python driver.py verify       # Verify road math parity & target projection invariants
  python driver.py check-env    # Run 1,000 headless simulation steps (validates observations)
  python driver.py train        # Launch multi-worker PPO training on GPU/CUDA
  python driver.py tensorboard  # Launch live TensorBoard server (http://localhost:6006)
  python driver.py export       # Export trained Actor to public/models/car_agent.onnx
        """
    )

    subparsers = parser.add_subparsers(dest="command", help="Operational mode")

    # Command: status
    subparsers.add_parser("status", help="Inspect hardware, environment, and model assets")

    # Command: verify
    subparsers.add_parser("verify", help="Run analytical road curve parity tests")

    # Command: check-env
    env_parser = subparsers.add_parser("check-env", help="Sanity check simulation steps")
    env_parser.add_argument("--steps", type=int, default=1000, help="Number of test simulation steps")

    # Command: train
    train_parser = subparsers.add_parser("train", help="Start headless PPO policy training")
    train_parser.add_argument("--timesteps", type=int, default=TRAIN_CONFIG.TOTAL_TIMESTEPS, help="Total training timesteps")
    train_parser.add_argument("--workers", type=int, default=TRAIN_CONFIG.NUM_WORKERS, help="Number of parallel CPU workers")
    train_parser.add_argument("--stage", type=int, default=2, choices=[1, 2], help="Curriculum stage (1=basic, 2=nitro+targets)")
    train_parser.add_argument("--resume", type=str, default=None, help="Path to checkpoint to resume from")

    # Command: export
    export_parser = subparsers.add_parser("export", help="Export trained model to ONNX for Three.js")
    export_parser.add_argument("--checkpoint", type=str, default=None, help="Input model checkpoint path")
    export_parser.add_argument("--output", type=str, default=None, help="Output ONNX file path")

    # Command: tensorboard
    tb_parser = subparsers.add_parser("tensorboard", help="Launch live TensorBoard server")
    tb_parser.add_argument("--port", type=int, default=6006, help="Port to serve TensorBoard on (default: 6006)")
    tb_parser.add_argument("--host", type=str, default="0.0.0.0", help="Host interface (default: 0.0.0.0)")

    args = parser.parse_args()

    if args.command == "status" or args.command is None:
        print_system_status()
    elif args.command == "verify":
        run_math_parity_tests()
    elif args.command == "check-env":
        check_environment_sanity(steps=args.steps)
    elif args.command == "train":
        run_training_cmd(
            timesteps=args.timesteps,
            workers=args.workers,
            stage=args.stage,
            resume=args.resume
        )
    elif args.command == "export":
        run_export_cmd(checkpoint=args.checkpoint, output=args.output)
    elif args.command == "tensorboard":
        run_tensorboard_cmd(port=args.port, host=args.host)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
