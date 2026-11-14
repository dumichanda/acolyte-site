"""Industry workspaces: which data an account's analyst sees, how it talks, its starter dashboards and daily brief.

An account's `industry` (admin.accounts.industry) picks one of these. 'all' sees every dataset.
"""
from pathlib import Path

HERE = Path(__file__).resolve().parent

INDUSTRIES = {
    # 'all' is an account setting only (the owner can use every analyst); questions always go to one analyst.
    "all": {
        "label": "All analysts (owner)", "name": "Acolyte Analyst",
        "semantic": ["semantic.md", "semantic_property.md"],
        "intro": "You cover every Acolyte dataset.",
    },
    "jobs": {
        "label": "Jobs & talent", "name": "Acolyte Talent Analyst",
        "semantic": ["semantic.md"],
        "intro": ("You work for HR, recruitment, training and B2B sales teams. Stay on the SA jobs data: hiring demand, "
                  "roles, skills, employers, salaries and automation potential."),
    },
    "property": {
        "label": "Property", "name": "Acolyte Property Analyst",
        "semantic": ["semantic_property.md"],
        "intro": ("You work for estate agencies, developers, banks and property investors in South Africa. Stay on the "
                  "SA property data: stock, asking prices, rents, yields, price cuts, agencies and areas. Use property "
                  "language (stock, mandates, asking price, days on market, gross yield). For an agency, frame findings "
                  "as where to list, how to price, and where competitors are gaining."),
    },
}


def semantic(industry: str) -> str:
    ind = INDUSTRIES.get(industry) or INDUSTRIES["all"]
    return "\n\n".join((HERE / f).read_text() for f in ind["semantic"])


# ---------------------------------------------------------------- starter dashboards (tiles re-run live)
_LATEST = "(SELECT max(day) FROM property_stock)"
PROPERTY_DASHBOARD = [
    {"type": "line", "x": "Day", "y": ["For sale", "To rent"], "value_format": "number",
     "title": "Homes on the market, South Africa", "subtitle": "Residential listings on Private Property, all provinces",
     "sql": """SELECT day AS "Day",
       sum(listings) FILTER (WHERE deal_type = 'sale') AS "For sale",
       sum(listings) FILTER (WHERE deal_type = 'rent') AS "To rent"
FROM property_stock WHERE is_province_total AND category = 'residential' GROUP BY day ORDER BY day"""},
    {"type": "bar", "x": "Province", "y": ["For sale", "To rent"], "value_format": "number",
     "title": "Residential stock by province", "subtitle": "Latest full count",
     "sql": f"""SELECT province AS "Province",
       sum(listings) FILTER (WHERE deal_type = 'sale') AS "For sale",
       sum(listings) FILTER (WHERE deal_type = 'rent') AS "To rent"
FROM property_stock WHERE is_province_total AND category = 'residential' AND day = {_LATEST}
GROUP BY province ORDER BY 2 DESC"""},
    {"type": "hbar", "x": "Region", "y": ["Homes for sale"], "value_format": "number",
     "title": "Biggest sales markets by region", "subtitle": "Residential for-sale listings, latest full count",
     "sql": f"""SELECT region AS "Region", listings AS "Homes for sale" FROM property_stock
WHERE NOT is_province_total AND deal_type = 'sale' AND category = 'residential' AND day = {_LATEST}
ORDER BY listings DESC LIMIT 15"""},
    {"type": "hbar", "x": "Region", "y": ["Median asking price"], "value_format": "rand",
     "title": "Median asking price of houses by region", "subtitle": "Sample of current listings (first pages per region), regions with 20+ houses",
     "sql": """SELECT region AS "Region", round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price_zar))::bigint AS "Median asking price"
FROM property_listings WHERE deal_type = 'sale' AND category = 'residential' AND property_type = 'House'
  AND price_zar > 0 AND active
GROUP BY region HAVING count(*) >= 20 ORDER BY 2 DESC LIMIT 15"""},
    {"type": "hbar", "x": "Region", "y": ["Median monthly rent"], "value_format": "rand",
     "title": "Median monthly rent by region", "subtitle": "Sample of current residential rentals, regions with 10+ listings",
     "sql": """SELECT region AS "Region", round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price_zar))::bigint AS "Median monthly rent"
FROM property_listings WHERE deal_type = 'rent' AND category = 'residential' AND price_zar > 0 AND active
GROUP BY region HAVING count(*) >= 10 ORDER BY 2 DESC LIMIT 15"""},
    {"type": "hbar", "x": "Region", "y": ["Gross yield %"], "value_format": "number",
     "title": "Indicative gross rental yield, 2-bedroom homes", "subtitle": "12 × median rent ÷ median asking price, sample",
     "sql": """WITH s AS (SELECT region, percentile_cont(0.5) WITHIN GROUP (ORDER BY price_zar) p FROM property_listings
           WHERE deal_type = 'sale' AND category = 'residential' AND beds = 2 AND price_zar > 0 AND active GROUP BY region HAVING count(*) >= 5),
     r AS (SELECT region, percentile_cont(0.5) WITHIN GROUP (ORDER BY price_zar) p FROM property_listings
           WHERE deal_type = 'rent' AND category = 'residential' AND beds = 2 AND price_zar > 0 AND active GROUP BY region HAVING count(*) >= 5)
SELECT region AS "Region", round((1200 * r.p / s.p)::numeric, 1) AS "Gross yield %" FROM s JOIN r USING (region)
ORDER BY 2 DESC LIMIT 15"""},
    {"type": "hbar", "x": "Agency", "y": ["Listings"], "value_format": "number",
     "title": "Agency share of listings", "subtitle": "Current listings in the sample, private sellers excluded",
     "sql": """SELECT agency AS "Agency", count(*) AS "Listings" FROM property_listings
WHERE active AND agency <> 'Private seller / not stated' GROUP BY agency ORDER BY 2 DESC LIMIT 12"""},
    {"type": "table", "x": "Suburb", "y": ["Asking price", "Change %"], "value_format": "rand",
     "title": "Latest price reductions", "subtitle": "Listings whose asking price dropped since we first saw them",
     "sql": """SELECT suburb AS "Suburb", region AS "Region", property_type AS "Type", beds AS "Beds",
       price_zar AS "Asking price", price_change_pct AS "Change %", agency AS "Agency", url AS "Listing"
FROM property_listings WHERE price_change_pct < 0 AND active ORDER BY last_seen DESC, price_change_pct LIMIT 25"""},
]

DASHBOARDS = {"property": ("Property market", PROPERTY_DASHBOARD)}

# ---------------------------------------------------------------- daily briefs
BRIEFS = {
    "property": (
        "Make me today's Daily Property Brief as a report pack for estate agency principals. Cover, in order of importance: "
        "(1) where stock for sale and to rent is rising or falling (province and region, latest full count versus the "
        "earliest day in the data, or say if there is only one day so far); (2) asking prices and rents by region, "
        "with indicative gross yields for 2-bedroom homes; (3) price reductions and listings with offers pending; "
        "(4) which agencies hold the most listings in the biggest regions; (5) the bond rate. Keep it to 4-6 sections. "
        "Actions should tell an agency where to focus listings and how to price."),
}
