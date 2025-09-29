#!/usr/bin/env python3
"""
fetch_instantly_replies.py

Fetch emails for a campaign that are received replies and marked as Interested,
deduplicate by message_id, and return cleaned plain-text bodies.

Usage:
  export INSTANTLY_API_KEY="your_api_key_here"
  python fetch_instantly_replies.py --campaign-id <CAMPAIGN_UUID> [--limit 200]
"""

import os
import time
import argparse
import requests
import html
import re
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv

load_dotenv()

API_BASE = "https://api.instantly.ai/api/v2"
API_KEY_ENV = "INSTANTLY_API_KEY"
DEFAULT_PAGE_LIMIT = 100

# Basic HTML -> text cleaner and quoted-block stripper
QUOTE_REGEX = re.compile(
    r"(^>.*?$)|(^On .*? wrote:.*?$)|(^From: .*?$)|(^Sent: .*?$)|(^-----Original Message-----.*?$)",
    re.IGNORECASE | re.MULTILINE | re.DOTALL,
)

HTML_TAG_RE = re.compile(r"<[^>]+>")
MULTI_NEWLINE_RE = re.compile(r"\n{2,}")

def clean_html_to_text(html_content: str) -> str:
    text = html.unescape(html_content or "")
    text = HTML_TAG_RE.sub("", text)
    text = text.replace("\r", "")
    text = MULTI_NEWLINE_RE.sub("\n\n", text).strip()
    text = QUOTE_REGEX.split(text)[0] if QUOTE_REGEX.search(text) else text
    return text.strip()

def request_with_retry(url: str, headers: Dict[str, str], params: Dict[str, Any], max_retries: int = 5) -> requests.Response:
    backoff = 1.0
    for attempt in range(1, max_retries + 1):
        resp = requests.get(url, headers=headers, params=params, timeout=30)
        if resp.status_code == 200:
            return resp
        if resp.status_code in (429, 500, 502, 503, 504):
            retry_after = resp.headers.get("Retry-After")
            wait = float(retry_after) if retry_after and retry_after.isdigit() else backoff
            time.sleep(wait)
            backoff = min(backoff * 2, 60.0)
            continue
        resp.raise_for_status()
    resp.raise_for_status()
    return resp

def fetch_replied_interested_emails(campaign_id: str, limit: int = DEFAULT_PAGE_LIMIT) -> List[Dict[str, Any]]:
    api_key = os.getenv(API_KEY_ENV)
    if not api_key:
        raise RuntimeError(f"Missing API key. Set the {API_KEY_ENV} environment variable.")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
    }

    url = f"{API_BASE}/emails"
    page = 1
    all_items: List[Dict[str, Any]] = []
    seen_message_ids = set()

    # Filters:
    # - campaign_id : campaign UUID
    # - email_type : received (use numeric enum 2 per schema or string 'received' depending on API; we use numeric 2)
    # - i_status : interest status = 1 (Interested)
    # The endpoint supports pagination via limit & page (or offset). We iterate until no more results.
    while True:
        params = {
            "campaign_id": campaign_id,
            "email_type": 2,      # received
            "i_status": 1,        # interested
            "limit": min(limit, 100),
            "page": page,
        }
        resp = request_with_retry(url, headers, params)
        data = resp.json()
        items = data.get("items") or data.get("data") or data.get("results") or data
        if isinstance(items, dict) and "items" in items:
            items = items["items"]

        if not items:
            break

        for item in items:
            msg_id = item.get("message_id") or item.get("id")
            if not msg_id:
                continue
            if msg_id in seen_message_ids:
                continue
            seen_message_ids.add(msg_id)

            # Prefer text body then html then content_preview
            body = ""
            body_obj = item.get("body") or {}
            if isinstance(body_obj, dict):
                body = body_obj.get("text") or body_obj.get("html") or item.get("content_preview") or ""
            else:
                body = item.get("content_preview") or ""

            if body and "<" in body and ">" in body:
                cleaned = clean_html_to_text(body)
            else:
                cleaned = (body or "").strip()

            record = {
                "message_id": msg_id,
                "timestamp_email": item.get("timestamp_email"),
                "lead": item.get("lead") or item.get("lead_id"),
                "subject": item.get("subject"),
                "thread_id": item.get("thread_id"),
                "ai_interest_value": item.get("ai_interest_value"),
                "i_status": item.get("i_status"),
                "cleaned_body": cleaned,
                "raw": item,
            }
            all_items.append(record)

        # Stop if fewer items returned than requested limit
        if len(items) < params["limit"]:
            break
        page += 1

    return all_items

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--campaign-id", "-c", required=True, help="Campaign UUID to filter emails")
    parser.add_argument("--limit", "-l", type=int, default=100, help="Page limit (max per request)")
    parser.add_argument("--output", "-o", help="Optional output JSON file to write results")
    args = parser.parse_args()

    results = fetch_replied_interested_emails(args.campaign_id, limit=args.limit)
    print(f"Fetched {len(results)} unique replied+interested emails for campaign {args.campaign_id}")

    if args.output:
        import json
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"Wrote results to {args.output}")
    else:
        for r in results:
            print("----")
            print(f"Lead: {r['lead']}\nSubject: {r['subject']}\nTimestamp: {r['timestamp_email']}\nBody:\n{r['cleaned_body'][:1000]}\n")

if __name__ == "__main__":
    main()
