"""
AES-256-GCM encryption for Kite access tokens stored at rest (AU-06).

Storage format: base64( nonce(12 B) || ciphertext+tag )
The 16-byte authentication tag is appended by AESGCM.encrypt automatically.
"""
from __future__ import annotations

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _load_key(key_b64: str) -> bytes:
    key = base64.b64decode(key_b64)
    if len(key) != 32:
        raise ValueError(f"Encryption key must be 32 bytes; got {len(key)}")
    return key


def encrypt_token(plaintext: str, key_b64: str) -> str:
    """Encrypt a Kite access token. Returns a base64-encoded string safe for DB storage."""
    aesgcm = AESGCM(_load_key(key_b64))
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    return base64.b64encode(nonce + ciphertext).decode("ascii")


def decrypt_token(ciphertext_b64: str, key_b64: str) -> str:
    """
    Decrypt a Kite access token.
    Raises cryptography.exceptions.InvalidTag if the ciphertext is tampered.
    """
    aesgcm = AESGCM(_load_key(key_b64))
    raw = base64.b64decode(ciphertext_b64)
    nonce, ct = raw[:12], raw[12:]
    return aesgcm.decrypt(nonce, ct, None).decode("utf-8")
