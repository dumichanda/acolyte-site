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


def setup_analyst_role(conn: psycopg.Connection) -> None:
    """Read-only login for the AI analyst: may read the `analyst` schema only (no CRM tables).

    Created when ANALYST_DB_PASSWORD is set (GitHub secret). The analyst service then connects with
    postgresql://analyst_web:<password>@<same Neon host>/neondb?sslmode=require
    """
    from psycopg import sql

    conn.execute("""DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analyst_reader') THEN CREATE ROLE analyst_reader NOLOGIN; END IF;
    END $$""")
    conn.execute("GRANT USAGE ON SCHEMA analyst TO analyst_reader")
    conn.execute("GRANT SELECT ON ALL TABLES IN SCHEMA analyst TO analyst_reader")
    pw = os.environ.get("ANALYST_DB_PASSWORD")
    if not pw:
        return
    exists = conn.execute("SELECT 1 FROM pg_roles WHERE rolname = 'analyst_web'").fetchone()
    verb = "ALTER" if exists else "CREATE"
    conn.execute(sql.SQL(verb + " ROLE analyst_web WITH LOGIN PASSWORD {}").format(sql.Literal(pw)))
    conn.execute("GRANT analyst_reader TO analyst_web")
    conn.execute("ALTER ROLE analyst_web SET default_transaction_read_only = on")
    conn.execute("ALTER ROLE analyst_web SET statement_timeout = '10s'")
    conn.execute("ALTER ROLE analyst_web SET search_path = analyst")


def init_db() -> None:
    """Create tables and views, and load salary defaults from the taxonomy."""
    from taxonomy import BY_NAME

    with connect() as conn:
        conn.execute((ROOT / "db" / "schema.sql").read_text())
        conn.execute((ROOT / "db" / "views.sql").read_text())
        conn.execute((ROOT / "db" / "crm.sql").read_text())
        conn.execute((ROOT / "db" / "analyst.sql").read_text())
        conn.execute((ROOT / "db" / "agents.sql").read_text())
        setup_analyst_role(conn)
        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO family_salary_default (role_family, annual_salary) VALUES (%s, %s)
                   ON CONFLICT (role_family) DO UPDATE SET annual_salary = EXCLUDED.annual_salary""",
                [(name, f["salary"]) for name, f in BY_NAME.items()],
            )
    print("Database ready.")


if __name__ == "__main__":
    init_db()
