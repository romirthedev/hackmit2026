"""One quota covering samples, continuous originals and conversational audio."""


def retained_bytes(db, connection=None):
    def total(c):
        tables = {row[0] for row in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        return sum(
            c.execute(f"SELECT COALESCE(SUM(bytes),0) FROM {table}").fetchone()[0]
            for table in ("media", "recording_chunks", "conversation_turns", "conversation_contexts")
            if table in tables
        )

    if connection is not None:
        return total(connection)
    with db.connect() as c:
        return total(c)
