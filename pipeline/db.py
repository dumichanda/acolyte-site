"""Database helpers. Set DATABASE_URL in .env (Neon: include ?sslmode=require)."""
import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

DEFAULT_URL = "postgresql://postgres@localhost:5432/acolyte"


def connect() -> psycopg.Connection:
    url = os.environ.get("DATABASE_URL") or ("" if os.environ.get("GITHUB_ACTIONS") else DEFAULT_URL)
    if not url:
        raise SystemExit("DATABASE_URL is empty. Add your Neon connection string as a GitHub Actions secret.")
    return psycopg.connect(url)


def init_db() -> None:
    """Create tables and views, and load salary defaults from the taxonomy."""
    from taxonomy import BY_NAME

    with connect() as conn:
        conn.execute((ROOT / "db" / "schema.sql").read_text())
        conn.execute((ROOT / "db" / "views.sql").read_text())
        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO family_salary_default (role_family, annual_salary) VALUES (%s, %s)
                   ON CONFLICT (role_family) DO UPDATE SET annual_salary = EXCLUDED.annual_salary""",
                [(name, f["salary"]) for name, f in BY_NAME.items()],
            )
    print("Database ready.")


if __name__ == "__main__":
    init_db()
