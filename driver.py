#!/usr/bin/env python3
"""
Autonomous Car Driver & Headless Training Pipeline Entry Point.
Forwarding wrapper for train.driver.

Usage Examples:
  python3 driver.py status          # View hardware resources and pipeline state
  python3 driver.py verify          # Validate road curve & target projection math
  python3 driver.py check-env       # Run 1,000 headless simulation test steps
  python3 driver.py train           # Start multi-worker PPO training (when ready)
  python3 driver.py export          # Export trained Actor to public/models/car_agent.onnx
"""

import os
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Auto-activate .venv if present and not already executing under it
VENV_PYTHON = os.path.join(BASE_DIR, ".venv", "bin", "python")
if os.path.exists(VENV_PYTHON) and os.path.abspath(sys.executable) != os.path.abspath(VENV_PYTHON):
    os.execv(VENV_PYTHON, [VENV_PYTHON] + sys.argv)

# Add train package directory to sys.path
TRAIN_DIR = os.path.join(BASE_DIR, "train")

if TRAIN_DIR not in sys.path:
    sys.path.insert(0, TRAIN_DIR)

from driver import main

if __name__ == "__main__":
    main()
