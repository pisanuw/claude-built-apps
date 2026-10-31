"""Tiny Brains League reference runtime (Python + NumPy).

Mirrors src/core/connect4.ts and src/core/net.ts: the same board, the same
84-number input encoding, the same forward pass and the same move rule, so a
network trained here plays identically on the ladder. Train however you like
(NumPy, PyTorch, evolution) and export with `save_brain`.

    python tiny_brains.py check my-brain.json     # validate + play 20 games vs random
    python tiny_brains.py parity ../test/fixtures/parity.json
"""
from __future__ import annotations

import json
import random
import sys

import numpy as np

COLS, ROWS = 7, 6
CELLS = COLS * ROWS
INPUTS, OUTPUTS = 2 * CELLS, COLS
FORMAT = "tiny-brains/v1"
BUDGET = 5000


class Board:
    def __init__(self) -> None:
        self.cells = [0] * CELLS  # row-major from the bottom row
        self.heights = [0] * COLS
        self.to_move = 1
        self.plies = 0

    def legal(self) -> list[int]:
        return [c for c in range(COLS) if self.heights[c] < ROWS]

    def play(self, col: int) -> int:
        if col not in self.legal():
            raise ValueError(f"illegal move {col}")
        idx = self.heights[col] * COLS + col
        self.cells[idx] = self.to_move
        self.heights[col] += 1
        self.to_move = 3 - self.to_move
        self.plies += 1
        return idx

    def wins_at(self, idx: int) -> bool:
        p = self.cells[idx]
        if p == 0:
            return False
        c0, r0 = idx % COLS, idx // COLS
        for dc, dr in ((1, 0), (0, 1), (1, 1), (1, -1)):
            n = 1
            for s in (1, -1):
                c, r = c0 + s * dc, r0 + s * dr
                while 0 <= c < COLS and 0 <= r < ROWS and self.cells[r * COLS + c] == p:
                    n += 1
                    c, r = c + s * dc, r + s * dr
            if n >= 4:
                return True
        return False


def encode(b: Board) -> np.ndarray:
    me = b.to_move
    x = np.zeros(INPUTS)
    for i, v in enumerate(b.cells):
        if v == me:
            x[i] = 1.0
        elif v != 0:
            x[CELLS + i] = 1.0
    return x


def load_brain(path: str) -> dict:
    with open(path) as f:
        brain = json.load(f)
    errors = validate(brain)
    if errors:
        raise ValueError("; ".join(errors))
    return brain


def validate(brain: dict, budget: int = BUDGET) -> list[str]:
    errs = []
    if brain.get("format") != FORMAT:
        errs.append(f'format must be "{FORMAT}"')
    if brain.get("activation") not in ("relu", "tanh"):
        errs.append('activation must be "relu" or "tanh"')
    layers = brain.get("layers") or []
    if not 1 <= len(layers) <= 4:
        return errs + ["layers must hold 1 to 4 layers"]
    nin, params = INPUTS, 0
    for i, layer in enumerate(layers):
        w = np.asarray(layer["weights"], dtype=float)
        b = np.asarray(layer["bias"], dtype=float)
        if w.shape != (len(b), nin):
            errs.append(f"layer {i}: weights shape {w.shape}, expected ({len(b)}, {nin})")
        if not (np.isfinite(w).all() and np.isfinite(b).all()):
            errs.append(f"layer {i}: weights must be finite")
        params += w.size + b.size
        nin = len(b)
    if nin != OUTPUTS:
        errs.append(f"last layer must have {OUTPUTS} outputs")
    if params > budget:
        errs.append(f"{params} parameters is over the {budget} budget")
    return errs


def logits(brain: dict, b: Board) -> np.ndarray:
    x = encode(b)
    layers = brain["layers"]
    for i, layer in enumerate(layers):
        x = np.asarray(layer["weights"], dtype=float) @ x + np.asarray(layer["bias"], dtype=float)
        if i < len(layers) - 1:
            x = np.maximum(x, 0.0) if brain["activation"] == "relu" else np.tanh(x)
    return x


def choose(brain: dict, b: Board) -> int:
    """Legal column with the highest logit; lowest column on ties (same rule as the ladder)."""
    z = logits(brain, b)
    legal = b.legal()
    best = legal[0]
    for c in legal:
        if z[c] > z[best]:
            best = c
    return best


def save_brain(path: str, name: str, activation: str, layers: list[tuple[np.ndarray, np.ndarray]]) -> None:
    """layers: (weights[out][in], bias[out]) pairs, first input size 84, last output size 7."""
    brain = {
        "format": FORMAT,
        "name": name,
        "activation": activation,
        "layers": [{"weights": np.asarray(w).round(6).tolist(), "bias": np.asarray(b).round(6).tolist()} for w, b in layers],
    }
    errs = validate(brain)
    if errs:
        raise ValueError("; ".join(errs))
    with open(path, "w") as f:
        json.dump(brain, f)


def play_vs_random(brain: dict, games: int = 20, seed: int = 0) -> float:
    rng = random.Random(seed)
    points = 0.0
    for g in range(games):
        b = Board()
        net_side = 1 if g % 2 == 0 else 2
        while True:
            col = choose(brain, b) if b.to_move == net_side else rng.choice(b.legal())
            mover = b.to_move
            idx = b.play(col)
            if b.wins_at(idx):
                points += 1.0 if mover == net_side else 0.0
                break
            if b.plies == CELLS:
                points += 0.5
                break
    return points / games


def parity(path: str) -> int:
    with open(path) as f:
        fx = json.load(f)
    bad = 0
    for case in fx["cases"]:
        b = Board()
        for m in case["moves"]:
            b.play(m)
        z = logits(fx["brain"], b)
        if not np.allclose(z, case["logits"], atol=1e-9) or choose(fx["brain"], b) != case["move"]:
            bad += 1
            print("mismatch at moves", case["moves"])
    print(f"{len(fx['cases']) - bad}/{len(fx['cases'])} positions match the TypeScript runtime")
    return 1 if bad else 0


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "check":
        brain = load_brain(sys.argv[2])
        print(f"{brain['name']}: valid; scores {play_vs_random(brain):.0%} vs a random mover over 20 games")
    elif len(sys.argv) == 3 and sys.argv[1] == "parity":
        sys.exit(parity(sys.argv[2]))
    else:
        print(__doc__)
