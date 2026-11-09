"""
Neural Network Architecture: Twin Actor-Critic Multi-Layer Perceptron (MLP).
Features decoupled Actor (Driver) and Critic (Coach) heads, Layer Normalization,
and Exponential Linear Unit (ELU) activations for gradient stability.
"""

import os
import sys
from typing import Tuple

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

from config import MODEL_CONFIG


class ActorNetwork(_MODULE_BASE):
    """
    Decoupled Actor (Driver) Policy Network.
    Maps 30-D observation vector to 3 continuous actions bounded to [-1.0, 1.0].
    
    Architecture:
      Input (30) -> Linear(128) -> LayerNorm(128) -> ELU
                 -> Linear(128) -> LayerNorm(128) -> ELU
                 -> Linear(64)  -> ELU
                 -> Linear(3)   -> Tanh
    """

    def __init__(
        self,
        obs_dim: int = MODEL_CONFIG.OBS_DIM,
        action_dim: int = MODEL_CONFIG.ACTION_DIM,
        hidden_layers: Tuple[int, ...] = MODEL_CONFIG.ACTOR_LAYERS,
        use_layer_norm: bool = MODEL_CONFIG.USE_LAYER_NORM
    ):
        if nn is None:
            raise ImportError("PyTorch ('torch') is required to instantiate ActorNetwork.")
        super().__init__()
        self.obs_dim = obs_dim
        self.action_dim = action_dim

        layers = []
        in_dim = obs_dim
        for i, h_dim in enumerate(hidden_layers):
            layers.append(nn.Linear(in_dim, h_dim))
            if use_layer_norm and (i < len(hidden_layers) - 1):
                layers.append(nn.LayerNorm(h_dim))
            layers.append(nn.ELU())
            in_dim = h_dim

        self.backbone = nn.Sequential(*layers)
        self.mean_head = nn.Linear(in_dim, action_dim)
        # Learnable log standard deviation for PPO continuous Gaussian policy
        self.log_std = nn.Parameter(torch.zeros(action_dim))

    def forward(self, obs: torch.Tensor) -> torch.Tensor:
        """
        Forward pass for inference.
        Returns deterministic bounded mean action in [-1.0, 1.0].
        """
        features = self.backbone(obs)
        return torch.tanh(self.mean_head(features))

    def sample_action(self, obs: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Samples an action from Gaussian distribution for PPO exploration.
        Returns (action, log_prob, mean).
        """
        mean = self.forward(obs)
        std = torch.exp(self.log_std)
        dist = torch.distributions.Normal(mean, std)
        raw_action = dist.rsample()
        action = torch.clamp(raw_action, -1.0, 1.0)
        log_prob = dist.log_prob(raw_action).sum(axis=-1)
        return action, log_prob, mean


class CriticNetwork(_MODULE_BASE):
    """
    Decoupled Critic (Coach) Value Network.
    Maps 30-D observation vector to scalar State Value V(s).
    
    Architecture:
      Input (30) -> Linear(128) -> LayerNorm(128) -> ELU
                 -> Linear(128) -> LayerNorm(128) -> ELU
                 -> Linear(64)  -> ELU
                 -> Linear(1)
    """

    def __init__(
        self,
        obs_dim: int = MODEL_CONFIG.OBS_DIM,
        hidden_layers: Tuple[int, ...] = MODEL_CONFIG.CRITIC_LAYERS,
        use_layer_norm: bool = MODEL_CONFIG.USE_LAYER_NORM
    ):
        if nn is None:
            raise ImportError("PyTorch ('torch') is required to instantiate CriticNetwork.")
        super().__init__()
        layers = []
        in_dim = obs_dim
        for i, h_dim in enumerate(hidden_layers):
            layers.append(nn.Linear(in_dim, h_dim))
            if use_layer_norm and (i < len(hidden_layers) - 1):
                layers.append(nn.LayerNorm(h_dim))
            layers.append(nn.ELU())
            in_dim = h_dim

        self.backbone = nn.Sequential(*layers)
        self.val_head = nn.Linear(in_dim, 1)

    def forward(self, obs: torch.Tensor) -> torch.Tensor:
        """Estimates state baseline value V(s)."""
        features = self.backbone(obs)
        return self.val_head(features)


class TwinActorCritic(_MODULE_BASE):
    """Container pairing Actor and Critic networks with no shared parameters."""

    def __init__(self):
        super().__init__()
        self.actor = ActorNetwork()
        self.critic = CriticNetwork()

    def forward(self, obs: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """Returns (action_mean, state_value)."""
        action = self.actor(obs)
        value = self.critic(obs)
        return action, value
