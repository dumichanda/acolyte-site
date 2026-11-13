"""Pull tools, skills, experience and work mode out of each job ad (free, rule-based).

    python pipeline/insights.py            # new or changed jobs only
    python pipeline/insights.py --all      # re-extract everything

Uses the full ad text when we have it (jobs.full_description), otherwise Adzuna's snippet.
The dictionaries below are South-Africa specific; add names as you meet them.
"""
import re
import sys

from db import connect, init_db

TOOLS = {
    # accounting / ERP
    "Sage Pastel": r"pastel|\bsage\b",
    "SAP": r"\bsap\b|s/?4 ?hana",
    "Syspro": r"syspro",
    "Xero": r"\bxero\b",
    "QuickBooks": r"quick ?books",
    "Oracle": r"\boracle\b",
    "Microsoft Dynamics": r"dynamics ?(365|nav|ax|gp)|navision|business central",
    "Acumatica": r"acumatica",
    "CaseWare": r"caseware",
    "Draftworx": r"draftworx",
    "SimplePay": r"simple ?pay",
    "VIP Payroll": r"\bvip (payroll|premier)\b",
    "PaySpace": r"payspace",
    "Sage 300 People": r"300 ?people",
    # office / data
    "Excel": r"\bexcel\b|spreadsheet",
    "Microsoft Office": r"ms ?office|microsoft office|office 365|\bm365\b|ms word|ms outlook",
    "Power BI": r"power ?bi",
    "SQL": r"\bsql\b",
    "Google Workspace": r"google (sheets|workspace|docs)",
    # CRM / contact centre / collections
    "Salesforce": r"salesforce",
    "HubSpot": r"hubspot",
    "Zoho": r"\bzoho\b",
    "Zendesk": r"zendesk",
    "Freshdesk": r"freshdesk",
    "Genesys": r"genesys",
    "Debtpack": r"debt ?pack",
    "Collections software (generic)": r"collections? (system|software)",
    "TransUnion / Experian / XDS": r"transunion|experian|\bxds\b|compuscan|credit bureau",
    # legal / conveyancing / insurance / logistics
    "Ghostconvey": r"ghost ?convey",
    "LegalSuite": r"legal ?suite",
    "Lightstone": r"lightstone",
    "Lexis / Deeds Office": r"lexis|deeds office|e-?dras",
    "Guidewire": r"guidewire",
    "Cargowise": r"cargo ?wise",
    "WMS": r"\bwms\b|warehouse management system",
    "eFiling (SARS)": r"e-?filing|sars",
    "CIPC": r"\bcipc\b",
}
SKILLS = {
    "Reconciliations": r"reconcil",
    "Creditors / accounts payable": r"creditor|accounts payable|\bap\b",
    "Debtors / accounts receivable": r"debtor|accounts receivable|\bar\b",
    "Month-end": r"month[- ]end",
    "VAT / tax": r"\bvat\b|\btax\b|emp ?201|irp ?5",
    "Payroll": r"payroll|salar(y|ies) (run|processing)",
    "Invoicing": r"invoic",
    "Data capturing": r"data (capture|capturing|entry)",
    "Collections": r"collect(ion|ing)|arrears|debt recovery",
    "Customer service": r"customer (service|care|support|queries)",
    "Outbound sales": r"outbound|telesales|cold call",
    "Claims processing": r"claim",
    "FICA / KYC": r"\bfica\b|\bkyc\b|anti[- ]money|\baml\b",
    "Reporting": r"report(s|ing)\b",
    "Scheduling / dispatch": r"schedul|dispatch|routing",
    "Filing / document management": r"filing|document(s|ation)? (management|control)",
    "Stock / inventory": r"stock|inventory",
    "Procurement": r"procure|purchas|buyer",
}
QUALS = {
    "Matric": r"matric|grade 12|nsc\b",
    "Diploma": r"diploma",
    "Degree": r"degree|bcom|b\.com|bachelor",
    "CA(SA) / SAIPA / SAICA": r"ca ?\(sa\)|saipa|saica|cima|acca",
    "NQF qualification": r"nqf",
    "Driver's licence": r"driver'?s? licen[cs]e|code (8|10|eb|c1)",
    "RE5 / FAIS": r"\bre ?5\b|\bfais\b",
}
LANGS = {"Afrikaans": r"afrikaans", "isiZulu": r"isizulu|zulu", "isiXhosa": r"isixhosa|xhosa", "Sesotho": r"sesotho|sotho",
         "Setswana": r"setswana|tswana", "Bilingual": r"bilingual"}


def find(d: dict, text: str) -> list[str]:
    return [k for k, rx in d.items() if re.search(rx, text, re.I)]


def experience(text: str) -> int | None:
    m = re.findall(r"(\d{1,2})\s*(?:\+|plus)?\s*(?:-|to|–)?\s*(?:\d{1,2}\s*)?years?'?\s*(?:of\s+)?(?:relevant\s+|working\s+|proven\s+)?experience", text, re.I)
    m = m or re.findall(r"(?:minimum|at least|min\.?)\s*(?:of\s*)?(\d{1,2})\s*years?", text, re.I)
    vals = [int(x) for x in m if 0 < int(x) < 30]
    return min(vals) if vals else None


def seniority(title: str, years: int | None) -> str:
    t = title.lower()
    if re.search(r"manager|head of|director|chief|lead\b", t):
        return "manager"
    if re.search(r"senior|\bsnr\b|\bsr\b|specialist|principal", t) or (years or 0) >= 5:
        return "senior"
    if re.search(r"junior|\bjnr\b|graduate|intern|trainee|learnership|entry", t) or (years is not None and years <= 1):
        return "junior"
    return "mid"


def work_mode(text: str) -> str:
    if re.search(r"hybrid", text, re.I):
        return "hybrid"
    if re.search(r"\bremote\b|work from home|\bwfh\b", text, re.I):
        return "remote"
    return "onsite"


def extract(title: str, text: str) -> dict:
    full = f"{title}\n{text}"
    years = experience(full)
    return {"tools": find(TOOLS, full), "skills": find(SKILLS, full), "qualifications": find(QUALS, full),
            "languages": find(LANGS, full), "experience_years": years, "seniority": seniority(title, years),
            "work_mode": work_mode(full)}


def main() -> None:
    init_db()
    redo = "--all" in sys.argv
    with connect() as conn:
        jobs = conn.execute(f"""
            SELECT j.id, j.title, COALESCE(j.full_description, j.description, ''), j.full_description IS NOT NULL
            FROM jobs j LEFT JOIN job_insights i ON i.job_id = j.id
            WHERE NOT j.is_demo {'' if redo else
              "AND (i.job_id IS NULL OR (j.full_description IS NOT NULL AND i.text_source = 'snippet'))"}""").fetchall()
        for jid, title, text, is_full in jobs:
            x = extract(title, text)
            conn.execute(
                """INSERT INTO job_insights (job_id, tools, skills, qualifications, experience_years, seniority, work_mode,
                                             languages, text_source)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (job_id) DO UPDATE SET tools=EXCLUDED.tools, skills=EXCLUDED.skills,
                     qualifications=EXCLUDED.qualifications, experience_years=EXCLUDED.experience_years,
                     seniority=EXCLUDED.seniority, work_mode=EXCLUDED.work_mode, languages=EXCLUDED.languages,
                     text_source=EXCLUDED.text_source, extracted_at=now()""",
                (jid, x["tools"], x["skills"], x["qualifications"], x["experience_years"], x["seniority"],
                 x["work_mode"], x["languages"], "full" if is_full else "snippet"),
            )
        conn.commit()
    print(f"Extracted tools/skills for {len(jobs)} jobs.")


if __name__ == "__main__":
    main()
