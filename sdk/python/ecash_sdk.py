"""
Ecash Protocol — Solana Mining SDK (Python)
Full documentation: https://github.com/ecashprotocol/ecash-solana/blob/main/skill/SKILL.md
"""

import json
import re
from typing import Optional, List, Dict, Any
import requests

# ============ Constants ============
PROGRAM_ID = "w4eVWehdAiLdrxYduaF6UvSxCXTj2uAnstHJTgucwiY"
MINT = "7ePGWB6HaHhwucuBXuu4mVVGYryvibtWxPVYCgvtjRC7"
GLOBAL_STATE = "Bswa2hSMZKhN2MVMMFUSX9QqT7MPyUzfSnp2VyjmtUiS"
VAULT = "9nhEukfrhisGX1wu7gRmPGucZ76H1UC5mMPh8xhBgM7y"
API_URL = "https://api.ecash.bot"


# ============ Answer Normalization ============
def normalize(answer: str) -> str:
    """
    Normalize answer: lowercase, strip non-alphanumeric (except spaces), collapse spaces.

    Examples:
        >>> normalize("Hello,   World!")
        'hello world'
        >>> normalize("A.B.C. Test!!!")
        'abc test'
    """
    s = answer.lower()
    s = re.sub(r'[^a-z0-9 ]', '', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


# ============ Blob Decryption ============
def decrypt_blob(puzzle_id: int, answer: str) -> Dict[str, Any]:
    """
    Decrypt puzzle blob using scrypt + AES-256-GCM.

    Args:
        puzzle_id: The puzzle ID (0-6299)
        answer: Your answer guess

    Returns:
        Dict with 'salt' and 'proof' if answer is correct

    Raises:
        ValueError: If answer is wrong (decryption fails)
        ImportError: If cryptography package not installed
    """
    try:
        from hashlib import scrypt as _scrypt
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError:
        raise ImportError("Install dependencies: pip install cryptography")

    normalized = normalize(answer)
    password = normalized.encode('utf-8')
    salt = f"ecash-v3-{puzzle_id}".encode('utf-8')

    # scrypt: N=131072, r=8, p=1, keyLen=32
    key = _scrypt(password, salt=salt, n=131072, r=8, p=1, dklen=32)

    # Fetch blob from API
    resp = requests.get(f"{API_URL}/puzzles/{puzzle_id}")
    puzzle = resp.json()

    if 'blob' not in puzzle or 'nonce' not in puzzle or 'tag' not in puzzle:
        raise ValueError(f"Puzzle {puzzle_id} blob data not found")

    nonce = bytes.fromhex(puzzle['nonce'])
    tag = bytes.fromhex(puzzle['tag'])
    ciphertext = bytes.fromhex(puzzle['blob'])

    # AES-256-GCM decrypt (ciphertext + tag)
    aesgcm = AESGCM(key)
    try:
        plaintext = aesgcm.decrypt(nonce, ciphertext + tag, None)
        return json.loads(plaintext.decode('utf-8'))
    except Exception as e:
        raise ValueError(f"Wrong answer (decryption failed): {e}")


# ============ Commit Hash ============
def compute_commit_hash(answer: str, salt_hex: str, secret_hex: str, signer_bytes: bytes) -> bytes:
    """
    Compute keccak256(answer || salt || secret || signer).

    Args:
        answer: The normalized answer
        salt_hex: Salt from decrypted blob (hex string, with or without 0x prefix)
        secret_hex: Random 32-byte secret (hex string)
        signer_bytes: Signer's public key (32 bytes)

    Returns:
        32-byte keccak256 hash
    """
    try:
        from sha3 import keccak_256
    except ImportError:
        try:
            from Crypto.Hash import keccak
            normalized = normalize(answer)
            combined = (
                normalized.encode('utf-8') +
                bytes.fromhex(salt_hex.replace('0x', '')) +
                bytes.fromhex(secret_hex.replace('0x', '')) +
                signer_bytes
            )
            k = keccak.new(digest_bits=256)
            k.update(combined)
            return k.digest()
        except ImportError:
            raise ImportError("Install sha3: pip install pysha3 or pycryptodome")

    normalized = normalize(answer)
    combined = (
        normalized.encode('utf-8') +
        bytes.fromhex(salt_hex.replace('0x', '')) +
        bytes.fromhex(secret_hex.replace('0x', '')) +
        signer_bytes
    )
    return keccak_256(combined).digest()


# ============ API Helpers ============
def get_puzzles(limit: int = 20, offset: int = 0, unsolved_only: bool = False) -> List[Dict]:
    """Get puzzles from the API."""
    params = {'limit': limit, 'offset': offset}
    if unsolved_only:
        params['unsolved'] = 'true'
    resp = requests.get(f"{API_URL}/puzzles", params=params)
    return resp.json()


def get_unsolved_puzzles(limit: int = 20) -> List[Dict]:
    """Get only unsolved puzzles."""
    puzzles = get_puzzles(limit=limit * 2)  # Fetch more to filter
    return [p for p in puzzles if not p.get('solved')][:limit]


def get_puzzle(puzzle_id: int) -> Dict:
    """Get a single puzzle by ID."""
    resp = requests.get(f"{API_URL}/puzzles/{puzzle_id}")
    return resp.json()


def get_stats() -> Dict:
    """Get protocol statistics."""
    resp = requests.get(f"{API_URL}/stats")
    return resp.json()


def get_leaderboard() -> List[Dict]:
    """Get the mining leaderboard."""
    resp = requests.get(f"{API_URL}/leaderboard")
    return resp.json()


def get_activity(limit: int = 10) -> List[Dict]:
    """Get recent solve activity."""
    resp = requests.get(f"{API_URL}/activity", params={'limit': limit})
    return resp.json()


def get_contract() -> Dict:
    """Get contract addresses and IDL."""
    resp = requests.get(f"{API_URL}/contract")
    return resp.json()


# ============ CLI ============
if __name__ == "__main__":
    import sys

    print("Ecash Protocol SDK")
    print(f"Program: {PROGRAM_ID}")
    print(f"Token: {MINT}")
    print()

    stats = get_stats()
    print(f"Total Solved: {stats.get('totalSolved', 'N/A')}")
    print(f"Current Batch: {stats.get('currentBatch', 'N/A')}")
    print(f"Current Era: {stats.get('currentEra', 'N/A')}")
    print(f"Reward per Solve: {stats.get('rewardPerPuzzle', 'N/A')} ECASH")
    print()

    unsolved = get_unsolved_puzzles(limit=5)
    print(f"Sample Unsolved Puzzles ({len(unsolved)} shown):")
    for p in unsolved[:3]:
        print(f"  #{p['puzzleId']}: {p['title']}")
