"""
Vectorized Multi-Worker PPO Headless Training Pipeline.
Optimized for NVIDIA GeForce RTX 2050 (4 GB GDDR6) & 8 CPU Simulation Workers.
Supports 2-Stage Curriculum Learning for Stable Policy Convergence.
"""

import os
import sys
from typing import Callable, Optional

# Ensure train directory is in path
_CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if _CURRENT_DIR not in sys.path:
    sys.path.insert(0, _CURRENT_DIR)

try:
    import torch
except ImportError:
    torch = None

try:
    from stable_baselines3 import PPO
    from stable_baselines3.common.vec_env import SubprocVecEnv, DummyVecEnv
    from stable_baselines3.common.callbacks import CheckpointCallback, BaseCallback
except ImportError:
    PPO = None
    SubprocVecEnv = None
    DummyVecEnv = None
    CheckpointCallback = None
    BaseCallback = object

from config import TRAIN_CONFIG, MODEL_CONFIG
from car_env import CarDashEnv


def make_env(stage: int = 2) -> Callable[[], CarDashEnv]:
    """Helper factory generating isolated environment instances for parallel workers."""
    def _init() -> CarDashEnv:
        return CarDashEnv(curriculum_stage=stage)
    return _init


def build_vectorized_env(num_workers: int = TRAIN_CONFIG.NUM_WORKERS, stage: int = 2):
    """Creates vectorized parallel environments across CPU cores."""
    if SubprocVecEnv is None:
        raise ImportError("stable-baselines3 is required to create vectorized environments.")

    # If running with 1 worker or testing, use DummyVecEnv to avoid subprocess overhead
    if num_workers <= 1:
        return DummyVecEnv([make_env(stage=stage)])

    return SubprocVecEnv([make_env(stage=stage) for _ in range(num_workers)])


def build_ppo_trainer(
    env,
    device: Optional[str] = None,
    learning_rate: float = TRAIN_CONFIG.LEARNING_RATE,
    tensorboard_log: Optional[str] = TRAIN_CONFIG.TENSORBOARD_DIR
) -> PPO:
    """Instantiates the PPO policy with ELU activations and decoupled MLP layers."""
    if PPO is None:
        raise ImportError("stable-baselines3 is required to initialize PPO trainer.")

    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"

    print(f"[Training Init] Utilizing compute device: {device.upper()}")
    if device == "cuda":
        print(f"[Training Init] GPU Device Name: {torch.cuda.get_device_name(0)}")

    policy_kwargs = dict(
        activation_fn=torch.nn.ELU,
        net_arch=dict(
            pi=list(MODEL_CONFIG.ACTOR_LAYERS),
            vf=list(MODEL_CONFIG.CRITIC_LAYERS)
        )
    )

    # Verify TensorBoard availability
    try:
        import tensorboard
        tb_log = tensorboard_log
    except ImportError:
        tb_log = None
        print("[Training Init] TensorBoard not installed; continuing with console logging only.")

    model = PPO(
        policy="MlpPolicy",
        env=env,
        policy_kwargs=policy_kwargs,
        learning_rate=learning_rate,
        n_steps=TRAIN_CONFIG.N_STEPS,
        batch_size=TRAIN_CONFIG.BATCH_SIZE,
        n_epochs=TRAIN_CONFIG.N_EPOCHS,
        gamma=TRAIN_CONFIG.GAMMA,
        gae_lambda=TRAIN_CONFIG.GAE_LAMBDA,
        clip_range=TRAIN_CONFIG.CLIP_RANGE,
        ent_coef=TRAIN_CONFIG.ENT_COEF,
        vf_coef=TRAIN_CONFIG.VF_COEF,
        max_grad_norm=TRAIN_CONFIG.MAX_GRAD_NORM,
        verbose=1,
        tensorboard_log=tb_log,
        device=device
    )

    return model


def start_training(
    total_timesteps: int = TRAIN_CONFIG.TOTAL_TIMESTEPS,
    num_workers: int = TRAIN_CONFIG.NUM_WORKERS,
    stage: int = 2,
    resume_from: Optional[str] = None
):
    """
    Executes the training loop.
    DO NOT invoke this automatically—this is executed via driver.py when the user decides.
    """
    os.makedirs(TRAIN_CONFIG.CHECKPOINT_DIR, exist_ok=True)
    os.makedirs(TRAIN_CONFIG.TENSORBOARD_DIR, exist_ok=True)

    print("=" * 70)
    print("STARTING GOAL-CONDITIONED AUTONOMOUS CAR PPO TRAINING")
    print(f"Total Timesteps  : {total_timesteps:,}")
    print(f"Parallel Workers : {num_workers}")
    print(f"Curriculum Stage : {stage}")
    print(f"TensorBoard Dir  : {TRAIN_CONFIG.TENSORBOARD_DIR}")
    print("=" * 70)

    env = build_vectorized_env(num_workers=num_workers, stage=stage)

    if resume_from and os.path.exists(resume_from):
        print(f"[Resume] Loading existing checkpoint from: {resume_from}")
        model = PPO.load(resume_from, env=env)
    else:
        model = build_ppo_trainer(env=env)

    # Periodic checkpointing callback (every 100,000 steps)
    checkpoint_callback = CheckpointCallback(
        save_freq=max(10_000, 100_000 // num_workers),
        save_path=TRAIN_CONFIG.CHECKPOINT_DIR,
        name_prefix="car_agent_step"
    )

    try:
        import tqdm
        import rich
        has_progress_bar = True
    except ImportError:
        has_progress_bar = False

    model.learn(
        total_timesteps=total_timesteps,
        callback=checkpoint_callback,
        progress_bar=has_progress_bar
    )

    # Save final model
    model.save(TRAIN_CONFIG.FINAL_MODEL_PATH)
    print(f"\n[Training Complete] Final model saved successfully to: {TRAIN_CONFIG.FINAL_MODEL_PATH}.zip")
    env.close()


if __name__ == "__main__":
    # Guard: do not run automatically
    print("Run training via the driver: python driver.py --train")
