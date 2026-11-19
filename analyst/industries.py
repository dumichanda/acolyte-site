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
        "semantic": ["semantic.md", "skills/jobs.md"],
        "intro": ("You work for HR, recruitment, training and B2B sales teams. Stay on the SA jobs data: hiring demand, "
                  "roles, skills, employers, salaries and automation potential."),
    },
    "property": {
        "label": "Property", "name": "Acolyte Property Analyst",
        "semantic": ["semantic_property.md", "skills/property.md"],
        "intro": ("You work for estate agencies, developers, banks and property investors in South Africa. Stay on the "
                  "SA property data: stock, asking prices, rents, yields, price cuts, agencies and areas. Use property "
                  "language (stock, mandates, asking price, days on market, gross yield). For an agency, frame findings "
                  "as where to list, how to price, and where competitors are gaining."),
    },
    "retail": {
        "label": "Retail pricing", "name": "Acolyte Retail Pricing Analyst",
        "semantic": ["semantic_retail.md", "skills/retail.md"],
        "intro": ("You work for FMCG brands, suppliers and retailers in South Africa. Stay on the SA retail price data: "
                  "shelf prices advertised online across grocery chains, wholesalers, pharmacies, quick commerce and "
                  "online marketplaces. Use pricing language (price index, price gap, basket, price ladder, promotion). "
                  "Always compare the same item on the same day and say how many items a comparison rests on."),
    },
    "marketplace": {
        "label": "Marketplaces", "name": "Acolyte Marketplace Analyst",
        "semantic": ["semantic_retail.md", "skills/marketplace.md"],
        "intro": ("You work for brands and sellers on South Africa's online marketplaces, Amazon.co.za and Takealot. "
                  "Focus on the 'online marketplace' channel and compare it with grocery chains and wholesale. "
                  "Always compare the same item on the same day and say how many items a comparison rests on."),
    },
}


def semantic(industry: str) -> str:
    ind = INDUSTRIES.get(industry) or INDUSTRIES["all"]
    return "\n\n".join((HERE / f).read_text() for f in ind["semantic"])


# ---------------------------------------------------------------- starter dashboards (tiles re-run live)
_LATEST = "(SELECT max(day) FROM property_stock)"
PROPERTY_DASHBOARD = [
    {"type": "table", "x": "Region", "y": ["Change"], "value_format": "number",
     "title": "What changed since the previous day", "subtitle": "Full stock counts per region, biggest moves first",
     "sql": """SELECT region AS "Region", deal_type AS "Deal", previous_listings AS "Previous", listings AS "Latest",
       change AS "Change", change_pct AS "Change %" FROM property_stock_changes
WHERE NOT is_province_total AND category = 'residential' AND day = (SELECT max(day) FROM property_stock)
  AND previous_day IS NOT NULL ORDER BY abs(change) DESC LIMIT 15"""},
    {"type": "line", "x": "Day", "y": ["For sale", "To rent"], "value_format": "number",
     "title": "Homes on the market, South Africa", "subtitle": "Residential listings from third-party data providers, all provinces",
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

_RLATEST = "(SELECT max(day) FROM retail_prices)"
RETAIL_DASHBOARD = [
    {"type": "table", "x": "Item", "y": ["Change %"], "value_format": "number",
     "title": "Price moves since the previous day", "subtitle": "Same item and retailer; −10% or more is likely a promotion",
     "sql": f"""SELECT item AS "Item", retailer AS "Retailer", previous_price_zar AS "Previous price", price_zar AS "Price",
       change_pct AS "Change %" FROM retail_price_changes WHERE day = {_RLATEST} AND change_zar <> 0
ORDER BY abs(change_pct) DESC LIMIT 20"""},
    {"type": "hbar", "x": "Retailer", "y": ["Items where cheapest"], "value_format": "number",
     "title": "Who is cheapest most often", "subtitle": "Basket items where each retailer had the lowest price, latest day",
     "sql": f"""WITH p AS (SELECT item, retailer, price_zar, rank() OVER (PARTITION BY item ORDER BY price_zar) r
           FROM retail_prices WHERE day = {_RLATEST})
SELECT retailer AS "Retailer", count(*) AS "Items where cheapest" FROM p WHERE r = 1 GROUP BY 1 ORDER BY 2 DESC"""},
    {"type": "bar", "x": "Channel", "y": ["Average gap to cheapest %"], "value_format": "number",
     "title": "Average price gap to the cheapest, by channel", "subtitle": "Same item, same day; 0% = always cheapest",
     "sql": f"""WITH p AS (SELECT item, channel, price_zar, min(price_zar) OVER (PARTITION BY item) AS cheapest
           FROM retail_prices WHERE day = {_RLATEST})
SELECT channel AS "Channel", round(avg(100.0 * (price_zar - cheapest) / cheapest), 1) AS "Average gap to cheapest %"
FROM p GROUP BY 1 ORDER BY 2"""},
    {"type": "hbar", "x": "Item", "y": ["Spread %"], "value_format": "number",
     "title": "Widest price spreads", "subtitle": "Dearest vs cheapest retailer for the same item, latest day",
     "sql": f"""SELECT item AS "Item", round(100.0 * (max(price_zar) - min(price_zar)) / min(price_zar)) AS "Spread %"
FROM retail_prices WHERE day = {_RLATEST} GROUP BY item HAVING count(*) >= 2 ORDER BY 2 DESC LIMIT 15"""},
    {"type": "bar", "x": "Category", "y": ["Retailers per item"], "value_format": "number",
     "title": "Price coverage by category", "subtitle": "Average number of retailers pricing each item, latest day",
     "sql": f"""SELECT category AS "Category", round(avg(n), 1) AS "Retailers per item" FROM
  (SELECT category, item, count(*) n FROM retail_prices WHERE day = {_RLATEST} GROUP BY 1, 2) x GROUP BY 1 ORDER BY 2 DESC"""},
    {"type": "table", "x": "Item", "y": ["Price"], "value_format": "rand",
     "title": "Latest prices", "subtitle": "Lowest matching price per retailer",
     "sql": f"""SELECT item AS "Item", retailer AS "Retailer", channel AS "Channel", price_zar AS "Price"
FROM retail_prices WHERE day = {_RLATEST} ORDER BY item, price_zar"""},
]
MARKETPLACE_DASHBOARD = [
    {"type": "bar", "x": "Item", "y": ["Amazon.co.za", "Takealot"], "value_format": "rand",
     "title": "Amazon.co.za vs Takealot", "subtitle": "Items both priced on the latest day",
     "sql": f"""SELECT item AS "Item", min(price_zar) FILTER (WHERE retailer = 'Amazon.co.za') AS "Amazon.co.za",
       min(price_zar) FILTER (WHERE retailer = 'Takealot') AS "Takealot"
FROM retail_prices WHERE day = {_RLATEST} GROUP BY item
HAVING count(*) FILTER (WHERE retailer = 'Amazon.co.za') > 0 AND count(*) FILTER (WHERE retailer = 'Takealot') > 0
ORDER BY 1"""},
    {"type": "hbar", "x": "Retailer", "y": ["Index vs cheapest store (100 = parity)"], "value_format": "number",
     "title": "Marketplaces vs the cheapest store", "subtitle": "Average of price ÷ cheapest grocery or wholesale price, same item",
     "sql": f"""WITH s AS (SELECT item, min(price_zar) p FROM retail_prices WHERE day = {_RLATEST}
           AND channel IN ('grocery chain', 'wholesale') GROUP BY item)
SELECT r.retailer AS "Retailer", round(avg(100.0 * r.price_zar / s.p)) AS "Index vs cheapest store (100 = parity)"
FROM retail_prices r JOIN s USING (item) WHERE r.day = {_RLATEST} AND r.channel = 'online marketplace' GROUP BY 1"""},
    {"type": "table", "x": "Item", "y": ["Price"], "value_format": "rand",
     "title": "Marketplace offers", "subtitle": "Matching offers on Amazon.co.za and Takealot, latest day",
     "sql": f"""SELECT item AS "Item", seller AS "Seller", title AS "Title", price_zar AS "Price", rating AS "Rating",
       reviews AS "Reviews" FROM retail_offers WHERE day = {_RLATEST} AND channel = 'online marketplace' AND matches_item
ORDER BY item, price_zar"""},
]

DASHBOARDS = {"property": ("Property market", PROPERTY_DASHBOARD), "retail": ("Retail prices", RETAIL_DASHBOARD),
              "marketplace": ("Marketplaces", MARKETPLACE_DASHBOARD)}

# ---------------------------------------------------------------- daily briefs
BRIEFS = {
    "property": (
        "Make me today's Daily Property Brief as a report pack for estate agency principals. Open with what changed since "
        "the previous day (analyst.property_stock_changes, then new listings and price cuts from property_daily_activity). "
        "Then cover, in order of importance: "
        "(1) where stock for sale and to rent is rising or falling (province and region, latest full count versus the "
        "earliest day in the data, or say if there is only one day so far); (2) asking prices and rents by region, "
        "with indicative gross yields for 2-bedroom homes; (3) price reductions and listings with offers pending; "
        "(4) which agencies hold the most listings in the biggest regions; (5) the bond rate. Keep it to 4-6 sections. "
        "Actions should tell an agency where to focus listings and how to price."),
    "retail": (
        "Make me today's Daily Retail Price Brief as a report pack for an FMCG brand or category manager. Open with what "
        "changed since the previous day (analyst.retail_price_changes: biggest moves, likely promotions). Then cover, in order "
        "of importance: (1) which retailer is cheapest on a like-for-like basket today and by how much; (2) price index by "
        "retailer and by channel; (3) the widest price spreads and biggest price moves since the earliest day (likely "
        "promotions), or the current spread if there is one day of data; (4) Amazon.co.za and Takealot versus grocery. "
        "Keep it to 4-6 sections, and state how many items each comparison rests on."),
}


# ---------------------------------------------------------------- monthly reports (public sample packs, 1st of each month)
MONTHLY = {
    "property": {
        "audience": "estate agency principals, developers and property investors", "since": "14 November 2026",
        "sections": ("residential stock by province and region, and how it moved within the month; asking prices, rents and "
                     "indicative 2-bed gross yields by region against the bond rate; price cuts and offers pending; agency "
                     "share of listings in the biggest regions; the flow of new listings (newest-listings feed)"),
    },
    "retail": {
        "audience": "FMCG brand, category and pricing managers", "since": "14 November 2026",
        "sections": ("which retailer is cheapest on a like-for-like basket; price index by retailer and by channel; the house-"
                     "brand discount against name brands (retail_unit_prices); the widest price spreads and the month's price "
                     "moves and likely promotions"),
    },
    "marketplace": {
        "audience": "brands and sellers on Amazon.co.za and Takealot", "since": "14 November 2026",
        "sections": ("Amazon.co.za versus Takealot on items both list; marketplace prices against the cheapest grocery or "
                     "wholesale store; assortment coverage, ratings and third-party seller pricing; online-shopping search "
                     "interest (Takealot, Amazon South Africa, Temu, Shein, Black Friday)"),
    },
    "jobs": {
        "audience": "HR, recruitment and workforce-planning leaders", "since": "12 November 2026",
        "sections": ("hiring demand by role family and province; who is hiring (top direct employers, share via recruiters) "
                     "with Glassdoor ratings; pay from Glassdoor salary benchmarks against advertised ranges; skills and "
                     "tools in demand; roles with the most automatable work"),
    },
}


def monthly_prompt(industry: str, period, month_to_date: bool) -> str:
    """Prompt for one monthly report. period = first day of the month."""
    from datetime import date
    m = MONTHLY[industry]
    first = period
    last = date(first.year + (first.month == 12), first.month % 12 + 1, 1)
    back = date(first.year - (first.month <= 5), (first.month - 6) % 12 + 1, 1)
    label = first.strftime("%B %Y")
    mtd = " This is a month-to-date edition: say so in the title (e.g. '(month to date)')." if month_to_date else ""
    return (
        f"Make the {label} monthly report pack for {m['audience']}. Period: {first} to {last} (exclusive).{mtd} "
        f"Our collection for this data started on {m['since']}: say so plainly, treat the first collection days as the "
        "baseline and never present figures for months before that as if we had them. Write 5 to 7 sections ordered by "
        "importance, each with an action title, a takeaway with numbers, KPI cards and a 'so what' for the reader. Cover: "
        f"(1) the month's headline numbers and what changed within the month (earliest vs latest day in the period); "
        f"(2) {m['sections']}; and (3) a 5-month demand look-back from {back.strftime('%B %Y')} to {label} using "
        "analyst.search_interest rows whose term_group ends in '12 months' (monthly averages of interest per term): name "
        "the trends, patterns and seasonal peaks, and what they mean for the reader. Finish with concrete actions for the "
        "coming month, and in the method say exactly which dates and datasets each part rests on.")
