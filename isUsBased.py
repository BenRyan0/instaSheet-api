import argparse
from dotenv import load_dotenv
import os
import re
import json
from firecrawl import Firecrawl

# Load environment variables
load_dotenv()
firecrawl_api_key = os.getenv("FIRECRAWL_API")
firecrawl = Firecrawl(api_key=firecrawl_api_key)

US_INDICATORS = {
    r"\bUnited States\b": 5,
    r"\bU\.S\.A?\b": 5,
    r"\bUSA\b": 5,
    r"\bAmerica\b": 4,
    r"\bAmerican Samoa\b": 3,
    r"\bGuam\b": 3,
    r"\bPuerto Rico\b": 3,
    r"\bU\.S\. Virgin Islands\b": 3,
    r"\bNorthern Mariana Islands\b": 3,
    r"\bU\.S\. Minor Outlying Islands\b": 3,
    r"\+1[-\s]?\(?\d{3}\)?[-\s]?\d{3}[-\s]?\d{4}\b": 2,
    r"\.us\b": 2,
    r"\.gov\b": 3,
    r"\.mil\b": 3,
    r"\$\s?\d": 1,
    r"\b(?:Alabama|Alaska|Arizona|Arkansas|California|Colorado|"
    r"Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|"
    r"Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|"
    r"Massachusetts|Michigan|Minnesota|Mississippi|Missouri|"
    r"Montana|Nebraska|Nevada|New Hampshire|New Jersey|"
    r"New Mexico|New York|North Carolina|North Dakota|Ohio|"
    r"Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|"
    r"South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|"
    r"Washington|West Virginia|Wisconsin|Wyoming|"
    r"District of Columbia)\b": 5,
}

US_PATTERNS = [(pat, re.compile(pat, re.IGNORECASE), weight) for pat, weight in US_INDICATORS.items()]


def analyze_us_matches(website: str):
    doc = firecrawl.scrape(website, formats=["html", "markdown"])

    content = ""
    for field in ("html", "markdown"):
        value = getattr(doc, field, None)
        if isinstance(value, str):
            content += value

    # Gather and print all words from the site
    # words = re.findall(r'\b\w+\b', content)
    # print("All words gathered from the site:")
    # print(words)

    matches_with_words = []
    total_weight = 0
    matches_weight = 0

    for pat, regex, weight in US_PATTERNS:
        matches = regex.findall(content)
        if matches:
            count = len(matches)
            matches_weight += count * weight
            total_weight += count * weight
            matches_with_words.append({
                "pattern": pat,
                "weight": weight,
                "count": count,
                "words": matches[:10]  # return up to 10 sample matches
            })

    if matches_weight == 0:
        return {"isUs": 0, "confidenceRate": 0, "matches": []}

    confidence_rate = min(100, round((matches_weight / (matches_weight + 10)) * 100))

    return {"isUs": 1, "confidenceRate": confidence_rate, "matches": matches_with_words}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("website", help="Website URL to check")
    args = parser.parse_args()
    site = args.website.strip()

    result = analyze_us_matches(site)
    print(json.dumps(result, indent=2))
