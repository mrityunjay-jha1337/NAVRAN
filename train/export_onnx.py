"""
ONNX Model Exporter for Browser Three.js / Rapier3D Runtime.
Extracts the trained Actor network from Stable-Baselines3 PPO checkpoint
and exports it to an optimized ONNX (opset 14) binary.
"""

import os
import sys
from typing import Optional

# Ensure train directory is in path
_CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if _CURRENT_DIR not in sys.path:
    sys.path.insert(0, _CURRENT_DIR)

try:
    import torch
    import torch.nn as nn
    _MODULE_BASE = nn.Module
except ImportError:
    torch = None
    nn = None
    _MODULE_BASE = object

try:
    from stable_baselines3 import PPO
except ImportError:
    PPO = None

from config import TRAIN_CONFIG, MODEL_CONFIG


class OnnxActor(_MODULE_BASE):
    """
    Inference-only PyTorch Actor wrapper for ONNX export.
    Takes 30-D observation tensor and outputs deterministic bounded 3-D action [-1.0, 1.0].
    """

    def __init__(self, policy):
        super().__init__()
        self.actor_net = policy.mlp_extractor.policy_net
        self.action_net = policy.action_net

    def forward(self, observation: torch.Tensor) -> torch.Tensor:
        features = self.actor_net(observation)
        # Deterministic Mean Action bounded to [-1.0, 1.0] matching SB3 predict
        action = torch.clamp(self.action_net(features), -1.0, 1.0)
        return action


def export_policy_to_onnx(
    checkpoint_path: Optional[str] = None,
    output_path: Optional[str] = None,
    opset_version: int = 18
) -> str:
    """
    Exports a trained PPO model to ONNX format.
    
    Args:
        checkpoint_path: Path to .zip checkpoint (defaults to TRAIN_CONFIG.FINAL_MODEL_PATH)
        output_path: Path for output .onnx file (defaults to TRAIN_CONFIG.ONNX_OUTPUT_PATH)
        opset_version: ONNX operator set version (default: 14)
        
    Returns:
        The absolute path to the generated ONNX model.
    """
    if PPO is None:
        raise ImportError("stable-baselines3 is required to load checkpoints for export.")

    if checkpoint_path is None:
        checkpoint_path = TRAIN_CONFIG.FINAL_MODEL_PATH
        if not os.path.exists(checkpoint_path) and os.path.exists(checkpoint_path + ".zip"):
            checkpoint_path = checkpoint_path + ".zip"

    if output_path is None:
        output_path = TRAIN_CONFIG.ONNX_OUTPUT_PATH

    if not os.path.exists(checkpoint_path):
        raise FileNotFoundError(f"Model checkpoint not found at: {checkpoint_path}")

    # Ensure output directory exists
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    print(f"[Export] Loading policy checkpoint from: {checkpoint_path}")
    model = PPO.load(checkpoint_path, device="cpu")

    onnx_actor = OnnxActor(model.policy)
    onnx_actor.eval()

    dummy_input = torch.zeros(1, MODEL_CONFIG.OBS_DIM, dtype=torch.float32)

    print(f"[Export] Exporting Actor network to ONNX opset {opset_version}...")
    torch.onnx.export(
        onnx_actor,
        dummy_input,
        output_path,
        export_params=True,
        input_names=["observation"],
        output_names=["action"],
        dynamic_axes={
            "observation": {0: "batch_size"},
            "action": {0: "batch_size"}
        },
        opset_version=opset_version
    )

    try:
        import onnx
        # Consolidate any external data into a single self-contained binary for browser WebAssembly
        model_proto = onnx.load(output_path, load_external_data=True)
        onnx.save(model_proto, output_path, save_as_external_data=False)
        data_file = output_path + ".data"
        if os.path.exists(data_file):
            os.remove(data_file)
    except Exception as e:
        pass

    size_kb = os.path.getsize(output_path) / 1024.0
    print(f"[Export] Successfully generated ONNX model at: {output_path} ({size_kb:.1f} KB)")
    return os.path.abspath(output_path)


if __name__ == "__main__":
    ckpt = sys.argv[1] if len(sys.argv) > 1 else None
    out = sys.argv[2] if len(sys.argv) > 2 else None
    export_policy_to_onnx(ckpt, out)
