"""
Parse Coles and Woolworths online-order PDF invoices into structured line items.

Text is extracted with `pdftotext -layout` (poppler-utils) because it preserves
the invoice's column layout far better than pure-Python extractors — and it
handles both vendors' PDFs reliably. The same code path runs locally (for the
initial bulk import) and inside the add-on (the upload-a-receipt feature).
"""
import re
import subprocess
from datetime import datetime

# App's canonical categories (mirror of the React CATEGORIES list).
CATEGORIES = [
    "Fresh Produce", "Meat & Seafood", "Dairy & Eggs", "Bakery", "Pantry & Dry",
    "Frozen", "Drinks", "Snacks & Treats", "Household", "Health & Personal",
    "Baby & Kids", "Pet",
]
NON_FOOD_CATEGORIES = {"Household", "Health & Personal", "Baby & Kids", "Pet"}

WOOLWORTHS_SECTIONS = {
    "bakery": "Bakery", "beauty": "Health & Personal", "biscuits & snacks": "Snacks & Treats",
    "chilled": "Dairy & Eggs", "dairy": "Dairy & Eggs", "fruit & vegetables": "Fresh Produce",
    "fruit & veg": "Fresh Produce", "meat": "Meat & Seafood", "seafood": "Meat & Seafood",
    "poultry": "Meat & Seafood", "seasonal": "Snacks & Treats", "serviced deli": "Meat & Seafood",
    "deli": "Meat & Seafood", "toiletries": "Health & Personal", "health & beauty": "Health & Personal",
    "health & wellness": "Health & Personal", "frozen": "Frozen", "drinks": "Drinks",
    "beverages": "Drinks", "pantry": "Pantry & Dry", "household": "Household", "cleaning": "Household",
    "laundry & cleaning": "Household", "baby": "Baby & Kids", "baby & child": "Baby & Kids",
    "pet": "Pet", "pet care": "Pet", "international foods": "Pantry & Dry",
    "breakfast foods": "Pantry & Dry", "tea & coffee": "Drinks", "confectionery": "Snacks & Treats",
    "front of store": "Snacks & Treats",
}
COLES_SECTIONS = {
    "chips, chocolates & snacks": "Snacks & Treats", "drinks": "Drinks",
    "dairy, eggs & fridge": "Dairy & Eggs", "fruit & vegetables": "Fresh Produce",
    "meat & seafood": "Meat & Seafood", "cleaning & laundry": "Household", "baby": "Baby & Kids",
    "down down": "Pantry & Dry", "pantry": "Pantry & Dry", "health & beauty": "Health & Personal",
    "dietary & world foods": "Pantry & Dry", "bakery": "Bakery", "frozen": "Frozen", "pet": "Pet",
    "deli": "Meat & Seafood", "household": "Household", "international foods & dietary": "Pantry & Dry",
    "tea, coffee & drinks": "Drinks", "breakfast": "Pantry & Dry",
}

# Keyword overrides for is_food (catch non-food items filed under food sections,
# e.g. Coles "Down Down" lumps cleaning products in with pantry).
NON_FOOD_KEYWORDS = [
    "toilet paper", "harpic", "bleach", "dishwash", "detergent", "laundry", "napisan",
    "vanish", "cleaner", "cleaning", "bin liner", "glad wrap", "alfoil", "paper towel",
    "nappy", "nappies", "nappies", "baby wipe", "wipes", "shampoo", "conditioner",
    "sunscreen", "toothpaste", "toothbrush", "deodorant", "body wash", "soap",
    "razor", "tampon", "pad", "panty", "tissues", "dettol", "finish ", "fabric",
    "dog ", "cat ", "pet ", "litter",
]
FOOD_KEYWORDS = ["soap-free body"]  # guard against false positives if ever needed

_PRICE = r"\$?([\d,]+\.\d{2})"
# Woolworths: <line> <desc> <ordered> <supplied[ kg]> $price $amount
_WW_ITEM = re.compile(
    r"^\s*(\d+)\s+(.+?)\s+([\d.]+)\s+([\d.]+(?:\s*kg)?)\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s*$"
)
# Coles in-line: <desc> <ordered> <picked[kg]> $unit $total
_COLES_ITEM = re.compile(
    r"^\s*(.+?)\s+([\d.]+)\s+([\d.]+\s*kg|[\d.]+)\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s*$"
)
# Coles wrapped (out-of-stock / substitute): just the numbers, desc on prior line
_COLES_NUMS = re.compile(
    r"^\s*([\d.]+)?\s*([\d.]+\s*kg|[\d.]+)?\s*\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s*$"
)


def pdf_to_text(data: bytes) -> str:
    """Extract layout-preserving text from PDF bytes via pdftotext."""
    proc = subprocess.run(
        ["pdftotext", "-layout", "-", "-"],
        input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
    )
    return proc.stdout.decode("utf-8", errors="replace")


def detect_vendor(text: str) -> str:
    low = text.lower()
    if "woolworths" in low:
        return "Woolworths"
    if "coles" in low:
        return "Coles"
    return "Unknown"


def _parse_date(text: str):
    m = re.search(r"Date:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})", text)
    if not m:
        m = re.search(r"Invoice date:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})", text)
    if m:
        for fmt in ("%d %b %Y", "%d %B %Y"):
            try:
                return datetime.strptime(m.group(1), fmt).date().isoformat()
            except ValueError:
                continue
    return None


def _unit_from_name(name: str) -> str:
    low = name.lower()
    if re.search(r"\beach\b|\bea\b|\bpunnet\b", low) and not re.search(r"\d+\s*(g|kg|ml|l)\b", low):
        return "ea"
    m = re.search(r"(\d+(?:\.\d+)?\s?(?:kg|g|ml|l|L))\b", name)
    if m:
        u = m.group(1).replace(" ", "")
        # loose weight (priced per kg) vs packaged size: "per 100g"/"approx" => kg loose
        if re.search(r"per\s+100\s?g|approx", low) or low.strip().endswith("kg"):
            return "kg"
        return u
    if re.search(r"\bpack\b|\bpk\b|pieces|\bx\d+\b", low):
        return "pack"
    if "each" in low:
        return "ea"
    return "ea"


def _is_food(category: str, name: str) -> bool:
    low = name.lower()
    if any(k in low for k in NON_FOOD_KEYWORDS):
        return False
    return category not in NON_FOOD_CATEGORIES


def _clean_name(raw: str) -> str:
    name = raw.strip().lstrip("*%").strip()
    name = re.sub(r"\s+", " ", name)
    # tidy doubled apostrophes from Coles ("Arnott''s")
    name = name.replace("''", "'")
    return name


def _add(items, vendor, category, raw_name, unit_price):
    name = _clean_name(raw_name)
    if not name or unit_price <= 0:
        return
    items.append({
        "name": name,
        "price": round(unit_price, 2),
        "unit": _unit_from_name(name),
        "category": category,
        "isFood": _is_food(category, name),
        "vendor": vendor,
        "gst": raw_name.lstrip().startswith(("*", "%")),
    })


def _parse_woolworths(text):
    items, category = [], "Pantry & Dry"
    for line in text.splitlines():
        s = line.strip()
        if not s:
            continue
        key = s.lower()
        if key in WOOLWORTHS_SECTIONS and "$" not in s:
            category = WOOLWORTHS_SECTIONS[key]
            continue
        m = _WW_ITEM.match(line)
        if m:
            _add(items, "Woolworths", category, m.group(2), float(m.group(5).replace(",", "")))
    return items


def _parse_coles(text):
    items, category = [], "Pantry & Dry"
    prev_desc = None
    for line in text.splitlines():
        s = line.strip()
        if not s:
            continue
        key = s.lower()
        if key in COLES_SECTIONS and "$" not in s:
            category = COLES_SECTIONS[key]
            prev_desc = None
            continue
        if key in ("product", "out of stock") or key.startswith("product "):
            continue
        if "$" not in s:
            # candidate description for a wrapped (out-of-stock) item
            prev_desc = s
            continue
        m = _COLES_ITEM.match(line)
        if m:
            _add(items, "Coles", category, m.group(1), float(m.group(4).replace(",", "")))
            prev_desc = None
            continue
        m = _COLES_NUMS.match(line)
        if m and prev_desc:
            _add(items, "Coles", category, prev_desc, float(m.group(3).replace(",", "")))
            prev_desc = None
    return items


def parse_receipt(data: bytes) -> dict:
    """Parse PDF bytes -> {vendor, date, items:[...]}. Items are de-duplicated
    within the receipt (keeping the first occurrence)."""
    text = pdf_to_text(data)
    vendor = detect_vendor(text)
    date = _parse_date(text)
    if vendor == "Woolworths":
        raw = _parse_woolworths(text)
    elif vendor == "Coles":
        raw = _parse_coles(text)
    else:
        raw = []
    seen, items = set(), []
    for it in raw:
        k = it["name"].lower()
        if k in seen:
            continue
        seen.add(k)
        items.append(it)
    return {"vendor": vendor, "date": date, "items": items}
