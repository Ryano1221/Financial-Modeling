"""
Extract text from PDF and run LLM to produce LeaseExtraction JSON.
"""
from __future__ import annotations

import json
import os
import re
from typing import BinaryIO

from models import LeaseExtraction


def extract_text_from_pdf(file: BinaryIO) -> str:
    """Extract raw text from a PDF file."""
    try:
        from pypdf import PdfReader
    except ImportError:
        raise ImportError("pypdf required: pip install pypdf")

    reader = PdfReader(file)
    parts = []
    for page in reader.pages:
        text = page.extract_text()
        if text:
            parts.append(text)
    return "\n\n".join(parts) if parts else ""


def _llm_extract(text: str) -> dict:
    """Call LLM to extract lease terms; returns raw dict for LeaseExtraction."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY environment variable is not set")

    try:
        from openai import OpenAI
    except ImportError:
        raise ImportError("openai required: pip install openai")

    client = OpenAI(api_key=api_key)

    schema_desc = """
{
  "rsf": {"value": <number or null>, "confidence": 0-1, "citation": "exact snippet from document"},
  "commencement": {"value": "YYYY-MM-DD or null", "confidence": 0-1, "citation": "snippet"},
  "expiration": {"value": "YYYY-MM-DD or null", "confidence": 0-1, "citation": "snippet"},
  "rent_steps_table": {"value": [{"start": 0, "end": 59, "rate_psf_yr": 30.0}, ...] or null, "confidence": 0-1, "citation": "snippet"},
  "free_rent": {"value": <months int or null>, "confidence": 0-1, "citation": "snippet"},
  "ti_allowance": {"value": <dollars per SF or null>, "confidence": 0-1, "citation": "snippet"},
  "opex_terms": {"value": "description of operating expense terms or null", "confidence": 0-1, "citation": "snippet"},
  "base_year_language": {"value": "base year / expense stop language or null", "confidence": 0-1, "citation": "snippet"},
  "parking_terms": {"value": "parking terms or null", "confidence": 0-1, "citation": "snippet"},
  "options": {"value": "renewal/expansion options or null", "confidence": 0-1, "citation": "snippet"},
  "termination_clauses": {"value": "termination/break clauses or null", "confidence": 0-1, "citation": "snippet"}
}
"""

    prompt = f"""You are a lease analyst. Extract key financial and legal terms from the following lease document text.
Output ONLY a single valid JSON object (no markdown, no code block) matching this schema. Use null for any value you cannot find.
For dates use YYYY-MM-DD when possible. For rent_steps_table.value use an array of objects with start (month index from 0), end (month index), rate_psf_yr (annual rate per square foot).
Keep citation snippets short (1-2 sentences from the document).

Schema:
{schema_desc}

Document text:
---
{text[:120000]}
---

JSON:"""

    response = client.chat.completions.create(
        model=os.environ.get("OPENAI_LEASE_MODEL", "gpt-4o-mini"),
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
    )
    raw = response.choices[0].message.content.strip()
    # Strip markdown code block if present
    if raw.startswith("```"):
        raw = re.sub(r"^```\w*\n?", "", raw)
        raw = re.sub(r"\n?```\s*$", "", raw)
    return json.loads(raw)


def extract_lease(pdf_file: BinaryIO) -> LeaseExtraction:
    """Extract text from PDF, run LLM, return LeaseExtraction."""
    text = extract_text_from_pdf(pdf_file)
    if not text or len(text.strip()) < 50:
        return LeaseExtraction()  # empty extraction
    data = _llm_extract(text)
    # Normalize to ExtractedField per key
    out = {}
    for key in LeaseExtraction.model_fields:
        if key not in data:
            out[key] = {"value": None, "confidence": 0.0, "citation": ""}
            continue
        obj = data[key]
        if isinstance(obj, dict):
            out[key] = {
                "value": obj.get("value"),
                "confidence": float(obj.get("confidence", 0.0)),
                "citation": str(obj.get("citation", "") or ""),
            }
        else:
            out[key] = {"value": obj, "confidence": 0.0, "citation": ""}
    return LeaseExtraction(**out)
