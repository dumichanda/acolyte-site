"""Seed clearly labelled SAMPLE jobs (is_demo = true) so the dashboards can be
built before live Adzuna data is loaded. Company names are fictional.

    python pipeline/seed_demo.py            # add ~450 sample jobs
    python pipeline/seed_demo.py --wipe     # delete all sample jobs
"""
import argparse
import random
from datetime import datetime, timedelta, timezone

from db import connect, init_db
from taxonomy import FAMILIES

rng = random.Random(42)

# Fictional, SA-flavoured company names.
_PREFIX = ["Ubuntu", "Karoo", "Highveld", "Protea", "Baobab", "Indaba", "Umoya", "Lekker", "Sizwe", "Thando",
           "Vaal", "Drakensberg", "Mzansi", "Kalahari", "Amandla", "Fynbos", "Boland", "Lowveld", "Impala", "Marula"]
_SUFFIX = ["Logistics", "Insurance Brokers", "Financial Services", "Freight", "Holdings", "Medical Group",
           "Property Group", "Attorneys", "Retail", "Contact Solutions", "Engineering", "Foods", "Auto Group",
           "Credit Solutions", "Rentals", "Distribution", "Accounting Services", "Telecoms", "Security", "Agri"]
COMPANIES = [f"{p} {s} (Sample)" for p, s in rng.sample([(p, s) for p in _PREFIX for s in _SUFFIX], 90)]

PROVINCE_WEIGHTS = {
    "Gauteng": 44, "Western Cape": 22, "KwaZulu-Natal": 14, "Eastern Cape": 6, "Mpumalanga": 4,
    "Free State": 3, "North West": 3, "Limpopo": 3, "Northern Cape": 1,
}
CITIES = {
    "Gauteng": ["Johannesburg", "Sandton", "Pretoria", "Midrand", "Centurion", "Kempton Park", "Roodepoort"],
    "Western Cape": ["Cape Town", "Bellville", "Stellenbosch", "Paarl", "George"],
    "KwaZulu-Natal": ["Durban", "Umhlanga", "Pinetown", "Pietermaritzburg", "Richards Bay"],
    "Eastern Cape": ["Gqeberha", "East London"],
    "Mpumalanga": ["Mbombela", "Witbank"],
    "Free State": ["Bloemfontein"],
    "North West": ["Rustenburg", "Potchefstroom"],
    "Limpopo": ["Polokwane"],
    "Northern Cape": ["Kimberley"],
}
# How often each family appears in SA job ads (rough weights for the sample).
FAMILY_WEIGHTS = {
    "Office & Admin Support": 16, "Customer Service & Call Centre": 15, "Bookkeeping & Accounts Admin": 9,
    "Creditors & Debtors": 9, "Sales Admin & Quoting": 8, "Logistics & Stock Admin": 8, "Data Capture": 6,
    "Collections": 6, "Claims Administration": 5, "Payroll": 5, "HR & Recruitment Admin": 4,
    "Compliance & FICA": 3, "Reporting & Data Analysis": 3, "Conveyancing & Legal Admin": 2,
    "Tender Administration": 1,
}
TITLES = {
    "Data Capture": ["Data Capturer", "Data Entry Clerk", "Junior Data Capturer"],
    "Creditors & Debtors": ["Creditors Clerk", "Debtors Clerk", "Accounts Payable Clerk", "Senior Creditors Clerk"],
    "Collections": ["Collections Agent", "Credit Controller", "Debt Collector"],
    "Claims Administration": ["Claims Administrator", "Short-Term Claims Administrator", "Medical Claims Assessor"],
    "Payroll": ["Payroll Administrator", "Payroll Officer", "Junior Payroll Clerk"],
    "Compliance & FICA": ["FICA Administrator", "Compliance Administrator", "KYC Analyst"],
    "Conveyancing & Legal Admin": ["Conveyancing Secretary", "Legal Secretary", "Paralegal"],
    "Tender Administration": ["Tender Administrator", "Bids Coordinator"],
    "Customer Service & Call Centre": ["Call Centre Agent", "Customer Service Consultant", "Inbound Contact Centre Agent", "Client Service Agent"],
    "Sales Admin & Quoting": ["Sales Administrator", "Internal Sales Administrator", "Quoting Clerk", "Order Processor"],
    "Logistics & Stock Admin": ["Logistics Coordinator", "Dispatch Clerk", "Stock Controller", "Import/Export Administrator"],
    "Bookkeeping & Accounts Admin": ["Bookkeeper", "Accounts Clerk", "Finance Administrator"],
    "Reporting & Data Analysis": ["Reporting Analyst", "BI Analyst", "Data Analyst"],
    "HR & Recruitment Admin": ["HR Administrator", "Recruitment Administrator"],
    "Office & Admin Support": ["Office Administrator", "Receptionist", "Personal Assistant", "Admin Assistant"],
}


def pick(weights: dict):
    return rng.choices(list(weights), weights=list(weights.values()))[0]


def make_job(i: int, now: datetime) -> tuple:
    fam_name = pick(FAMILY_WEIGHTS)
    fam = next(f for f in FAMILIES if f["name"] == fam_name)
    title = rng.choice(TITLES[fam_name])
    province = pick(PROVINCE_WEIGHTS)
    city = rng.choice(CITIES[province])
    # Hiring ramps up slightly over the window so the trend line has a story.
    days_ago = int(abs(rng.triangular(0, 45, 0)))
    posted = now - timedelta(days=days_ago, hours=rng.randint(0, 23))
    has_salary = rng.random() < 0.55
    base = fam["salary"] * rng.uniform(0.75, 1.3) * (1.12 if province in ("Gauteng", "Western Cape") else 0.95)
    smin, smax = (round(base * 0.9, -3), round(base * 1.1, -3)) if has_salary else (None, None)
    desc = (f"SAMPLE POSTING. {title} required in {city}. Responsibilities include "
            + "; ".join(t.lower() for t in fam["tasks"]) + ".")
    return (
        f"demo:{i}", "demo", True, title, rng.choice(COMPANIES), desc, province, city, fam["category"],
        rng.choice(["permanent", "permanent", "contract"]), "full_time", smin, smax, False, posted,
        None, None,
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=450)
    ap.add_argument("--wipe", action="store_true")
    args = ap.parse_args()
    init_db()
    with connect() as conn:
        n = conn.execute("DELETE FROM jobs WHERE is_demo").rowcount
        if args.wipe:
            print(f"Removed {n} sample jobs.")
            return
        now = datetime.now(timezone.utc)
        rows = [make_job(i, now) for i in range(args.count)]
        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO jobs (id, source, is_demo, title, company, description, province, city, category,
                   contract_type, contract_time, salary_min, salary_max, salary_is_predicted, posted_at, url, search_term)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                rows,
            )
    print(f"Seeded {len(rows)} sample jobs (is_demo = true).")


if __name__ == "__main__":
    main()
