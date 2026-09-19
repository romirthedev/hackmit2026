"""Short-lived, single-use browser invitations; only hashed credentials are stored."""

import hashlib
import hmac
import secrets
import time

from fastapi import HTTPException

PAIRING_SECONDS = 600
RATE_WINDOW = 60


class BrowserPairing:
    def __init__(self, db, signing_key):
        self.db = db
        self.signing_key = signing_key.encode()

    def digest(self, kind, value):
        return hmac.new(self.signing_key, f"pairing:{kind}:{value}".encode(), hashlib.sha256).hexdigest()

    def create(self):
        code = f"{secrets.randbelow(100_000_000):08d}"
        ticket = secrets.token_urlsafe(32)
        expires = time.time() + PAIRING_SECONDS
        with self.db.connect() as c:
            c.execute("BEGIN IMMEDIATE")
            # Only the newest invitation is active, keeping the short-code search space bounded.
            c.execute("DELETE FROM browser_pairings")
            c.execute(
                "INSERT INTO browser_pairings VALUES(?,?,?)",
                (self.digest("ticket", ticket), self.digest("code", code), expires),
            )
        return {"code": code[:4] + "-" + code[4:], "ticket": ticket, "expires_at": expires}

    def redeem(self, *, code, ticket, peer, test_code=""):
        now = time.time()
        limited = False
        accepted = False
        # Database transactions make redemption and rate limits safe across API processes/restarts.
        with self.db.connect() as c:
            c.execute("BEGIN IMMEDIATE")
            c.execute("DELETE FROM browser_pairings WHERE expires_at <= ?", (now,))
            c.execute("DELETE FROM pairing_attempts WHERE started_at <= ?", (now - RATE_WINDOW,))
            buckets = [("global", 50), (self.digest("peer", peer), 10)]
            for bucket, limit in buckets:
                row = c.execute("SELECT attempts FROM pairing_attempts WHERE bucket=?", (bucket,)).fetchone()
                if row and row["attempts"] >= limit:
                    limited = True
            if not limited:
                for bucket, _ in buckets:
                    c.execute(
                        "INSERT INTO pairing_attempts VALUES(?,?,1) "
                        "ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1",
                        (bucket, now),
                    )
                field = "ticket_hash" if ticket else "code_hash"
                digest = self.digest("ticket", ticket) if ticket else self.digest("code", code)
                accepted = bool(
                    test_code and not ticket and hmac.compare_digest(code.encode(), test_code.encode())
                )
                accepted = accepted or (
                    c.execute(
                        f"DELETE FROM browser_pairings WHERE {field}=? AND expires_at>?",
                        (digest, now),
                    ).rowcount
                    == 1
                )
        # Raise after committing: failed attempts must remain recorded.
        if limited:
            raise HTTPException(
                429, "Too many attempts. Wait one minute and try again.", headers={"Retry-After": "60"}
            )
        if not accepted:
            raise HTTPException(401, "This invitation is invalid, expired, or already used. Get a new one.")
