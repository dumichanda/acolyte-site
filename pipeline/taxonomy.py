"""Role families Acolyte targets in South Africa.

Order matters: the first family whose keywords match a job title wins, so the
more specific families come before the generic ones (e.g. Collections before
Customer Service, Payroll before Office & Admin).

Scores and salaries are planning heuristics for the rules classifier. The
Claude classifier (classify.py --claude) scores each posting individually.
"""

FAMILIES = [
    {
        "name": "Data Capture",
        "keywords": ["data capturer", "data capture", "data entry", "data typist", "capturer", "data clerk"],
        "score": 85,
        "salary": 132_000,
        "service": "Intelligent document processing (OCR + AI extraction)",
        "tasks": ["Keying data from forms and invoices", "Checking records for errors", "Updating spreadsheets and systems"],
        "category": "Admin Jobs",
    },
    {
        "name": "Creditors & Debtors",
        "keywords": ["creditors", "debtors", "accounts payable", "accounts receivable", "billing clerk", "billing administrator", "ap clerk", "ar clerk"],
        "score": 70,
        "salary": 216_000,
        "service": "Invoice & payment automation (Sage / Pastel / Xero integration)",
        "tasks": ["Capturing supplier invoices", "Matching invoices to orders", "Statement reconciliations", "Payment runs and remittances"],
        "category": "Accounting & Finance Jobs",
    },
    {
        "name": "Collections",
        "keywords": ["collections", "collection agent", "collector", "debt", "credit controller", "credit control", "arrears", "recoveries"],
        "score": 65,
        "salary": 156_000,
        "service": "Automated WhatsApp/SMS/email reminders with payment links",
        "tasks": ["Payment reminder calls and messages", "Logging promises to pay", "Updating account statuses"],
        "category": "Accounting & Finance Jobs",
    },
    {
        "name": "Claims Administration",
        "keywords": ["claims", "claim administrator", "claims assessor", "underwriting administrator", "policy administrator"],
        "score": 65,
        "salary": 240_000,
        "service": "Claims intake & document validation AI",
        "tasks": ["Reading claim documents", "Validating policy cover", "Routing and status updates"],
        "category": "Insurance Jobs",
    },
    {
        "name": "Payroll",
        "keywords": ["payroll", "salaries administrator", "wages clerk", "time and attendance"],
        "score": 50,
        "salary": 300_000,
        "service": "Payroll data collection & payslip automation",
        "tasks": ["Collecting timesheets and leave", "Capturing changes into payroll", "Distributing payslips"],
        "category": "Accounting & Finance Jobs",
    },
    {
        "name": "Compliance & FICA",
        "keywords": ["fica", "kyc", "compliance administrator", "compliance officer", "aml", "onboarding administrator", "vetting"],
        "score": 55,
        "salary": 300_000,
        "service": "KYC/FICA verification workflow automation",
        "tasks": ["Checking ID and proof of address", "Sanctions/PEP screening", "Filing and audit trails"],
        "category": "Legal Jobs",
    },
    {
        "name": "Conveyancing & Legal Admin",
        "keywords": ["conveyancing", "conveyancer", "legal secretary", "paralegal", "legal administrator", "transfer secretary"],
        "score": 50,
        "salary": 300_000,
        "service": "Legal document assembly & matter status updates",
        "tasks": ["Drafting standard documents", "Chasing banks and attorneys for status", "Client update emails"],
        "category": "Legal Jobs",
    },
    {
        "name": "Tender Administration",
        "keywords": ["tender", "bid administrator", "bids coordinator", "proposal coordinator"],
        "score": 55,
        "salary": 300_000,
        "service": "Tender monitoring & bid pack automation",
        "tasks": ["Scanning eTenders and portals", "Collecting compliance documents", "Assembling bid packs"],
        "category": "Admin Jobs",
    },
    {
        "name": "Customer Service & Call Centre",
        "keywords": ["call centre", "call center", "contact centre", "customer service", "customer care", "client service", "inbound", "outbound agent", "helpdesk", "help desk", "customer support", "client liaison"],
        "score": 60,
        "salary": 120_000,
        "service": "WhatsApp & web AI agents with ticket triage",
        "tasks": ["Answering repetitive queries", "Logging and routing tickets", "Order and account status lookups"],
        "category": "Customer Services Jobs",
    },
    {
        "name": "Sales Admin & Quoting",
        "keywords": ["sales administrator", "sales admin", "sales support", "quoting", "quotation", "order processor", "order capturer", "order administrator", "sales coordinator", "internal sales"],
        "score": 60,
        "salary": 204_000,
        "service": "Quote generation & CRM automation",
        "tasks": ["Building quotes from price lists", "Capturing orders", "Updating CRM records"],
        "category": "Sales Jobs",
    },
    {
        "name": "Logistics & Stock Admin",
        "keywords": ["dispatch", "logistics", "stock controller", "inventory", "warehouse administrator", "shipping", "freight", "import", "export", "fleet administrator", "procurement administrator", "buyer"],
        "score": 50,
        "salary": 216_000,
        "service": "Shipment tracking, POD capture & stock reporting automation",
        "tasks": ["Tracking shipments and updating customers", "Capturing proof of delivery", "Stock reports and reorders"],
        "category": "Logistics & Warehouse Jobs",
    },
    {
        "name": "Bookkeeping & Accounts Admin",
        "keywords": ["bookkeeper", "bookkeeping", "accounts clerk", "accounts administrator", "finance clerk", "finance administrator", "accounts assistant", "reconciliation", "creditor", "debtor"],
        "score": 55,
        "salary": 264_000,
        "service": "Bank reconciliation & month-end automation",
        "tasks": ["Bank and ledger reconciliations", "Journal capturing", "Month-end reporting packs"],
        "category": "Accounting & Finance Jobs",
    },
    {
        "name": "Reporting & Data Analysis",
        "keywords": ["data analyst", "reporting analyst", "bi analyst", "business intelligence", "mis ", "report writer", "power bi", "reporting specialist"],
        "score": 45,
        "salary": 480_000,
        "service": "Automated dashboards & AI-written management reports",
        "tasks": ["Pulling data into Excel", "Building recurring reports", "Writing commentary"],
        "category": "IT Jobs",
    },
    {
        "name": "HR & Recruitment Admin",
        "keywords": ["hr administrator", "human resources administrator", "hr assistant", "recruitment administrator", "recruitment coordinator", "talent acquisition coordinator", "hr officer"],
        "score": 45,
        "salary": 240_000,
        "service": "CV screening, scheduling & onboarding automation",
        "tasks": ["Screening CVs", "Scheduling interviews", "Onboarding paperwork"],
        "category": "HR & Recruitment Jobs",
    },
    {
        "name": "Office & Admin Support",
        "keywords": ["administrator", "admin assistant", "administrative", "receptionist", "personal assistant", "secretary", "office manager", "office assistant", "admin clerk", "clerk", "typist"],
        "score": 45,
        "salary": 180_000,
        "service": "Email/calendar triage & WhatsApp front desk",
        "tasks": ["Email and calendar handling", "Document filing", "Answering routine enquiries"],
        "category": "Admin Jobs",
    },
]

OTHER = {
    "name": "Other",
    "score": 15,
    "salary": 300_000,
    "service": "Process review",
    "tasks": [],
    "category": "Other/General Jobs",
}

FAMILY_NAMES = [f["name"] for f in FAMILIES] + [OTHER["name"]]
BY_NAME = {f["name"]: f for f in FAMILIES + [OTHER]}

# SA provinces (canonical names) for normalising source locations.
PROVINCES = [
    "Gauteng", "Western Cape", "KwaZulu-Natal", "Eastern Cape", "Free State",
    "Mpumalanga", "Limpopo", "North West", "Northern Cape",
]
