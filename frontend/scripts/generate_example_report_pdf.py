#!/usr/bin/env python3
"""Generate a robust static example report PDF for frontend preview."""

from __future__ import annotations

from pathlib import Path

PAGE_W = 612
PAGE_H = 792
MARGIN_X = 54
TOP_Y = 748


def pdf_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def write_line_ops(lines: list[tuple[str, int]], start_y: int = TOP_Y) -> str:
    ops: list[str] = []
    y = start_y
    for text, size in lines:
        if text == "":
            y -= int(size * 1.05)
            continue
        safe = pdf_escape(text)
        ops.append("BT")
        ops.append(f"/F1 {size} Tf")
        ops.append(f"1 0 0 1 {MARGIN_X} {y} Tm")
        ops.append(f"({safe}) Tj")
        ops.append("ET")
        y -= int(size * 1.38)
    return "\n".join(ops) + "\n"


def content_stream(lines: list[tuple[str, int]]) -> bytes:
    text_ops = write_line_ops(lines)
    return text_ops.encode("latin-1", errors="replace")


def build_pdf(pages: list[list[tuple[str, int]]]) -> bytes:
    n = len(pages)
    font_obj = 3 + 2 * n

    objects: list[bytes] = []

    # 1: Catalog
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")

    # 2: Pages tree
    kids = " ".join(f"{3 + 2 * i} 0 R" for i in range(n))
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {n} >>".encode())

    # Page objects + content streams
    for i, page_lines in enumerate(pages):
        page_id = 3 + 2 * i
        content_id = page_id + 1
        page_obj = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] "
            f"/Resources << /Font << /F1 {font_obj} 0 R >> >> /Contents {content_id} 0 R >>"
        )
        objects.append(page_obj.encode())

        stream = content_stream(page_lines)
        stream_obj = (
            f"<< /Length {len(stream)} >>\nstream\n".encode()
            + stream
            + b"endstream"
        )
        objects.append(stream_obj)

    # Font object
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    out = bytearray()
    out.extend(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")

    offsets = [0]
    for idx, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out.extend(f"{idx} 0 obj\n".encode())
        out.extend(obj)
        out.extend(b"\nendobj\n")

    xref_start = len(out)
    out.extend(f"xref\n0 {len(objects) + 1}\n".encode())
    out.extend(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        out.extend(f"{off:010d} 00000 n \n".encode())

    out.extend(
        (
            "trailer\n"
            f"<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            "startxref\n"
            f"{xref_start}\n"
            "%%EOF\n"
        ).encode()
    )

    return bytes(out)


def page_cover() -> list[tuple[str, int]]:
    return [
        ("Lease Financial Analysis", 34),
        ("", 20),
        ("Class-A Office Tower | 725 Market Street, San Francisco, CA", 14),
        ("Prepared for: Northbridge Capital Advisors", 13),
        ("Prepared by: Lease Deck Analytics", 13),
        ("Report date: February 12, 2026", 13),
        ("", 20),
        ("CONFIDENTIAL - For investment committee use only", 12),
        ("", 26),
        ("At-a-glance", 18),
        ("- Proposed premises: Floors 18-22 (108,450 RSF)", 12),
        ("- Initial term: 10 years with one 5-year renewal option", 12),
        ("- Starting base rent: $72.00/RSF (3.25% annual escalations)", 12),
        ("- TI allowance: $120/RSF; free rent: 8 months gross", 12),
        ("- Estimated present value rent obligation: $62.8M", 12),
        ("- Expected occupancy date: November 1, 2026", 12),
    ]


def page_exec_summary() -> list[tuple[str, int]]:
    return [
        ("1. Executive Summary", 24),
        ("", 10),
        (
            "The proposed lease is economically competitive for upper-floor Class-A product and aligns with the",
            11,
        ),
        (
            "tenant's growth strategy. Landlord concessions offset above-market face rent in years 1-3.",
            11,
        ),
        ("", 12),
        ("Recommendation", 16),
        (
            "Proceed with negotiation subject to final language on operating expense caps, assignment rights,",
            11,
        ),
        ("and HVAC after-hours charges. Economics are acceptable at target hurdle rates.", 11),
        ("", 14),
        ("Key Metrics", 16),
        ("- Nominal rent over term: $91.6M", 11),
        ("- Net effective rent: $64.84/RSF", 11),
        ("- Tenant-improvement net benefit: $13.0M", 11),
        ("- Present value (8.5% discount): $62.8M", 11),
        ("- Annual occupancy cost growth: 4.1% CAGR", 11),
        ("", 14),
        ("Comparable Benchmark Position", 16),
        ("- Face rent percentile vs comps: 62nd", 11),
        ("- Effective rent percentile vs comps: 49th", 11),
        ("- Free-rent package percentile vs comps: 71st", 11),
        ("- Landlord credit rating: investment-grade equivalent", 11),
    ]


def page_financials() -> list[tuple[str, int]]:
    return [
        ("2. 10-Year Cash Flow Profile", 24),
        ("", 10),
        ("Year | Base Rent ($M) | OpEx + Tax ($M) | Abatements/Credits ($M) | Total Cash Out ($M)", 10),
        ("2027 | 5.95 | 1.62 | -2.84 | 4.73", 10),
        ("2028 | 6.15 | 1.69 | -1.05 | 6.79", 10),
        ("2029 | 6.35 | 1.76 | 0.00 | 8.11", 10),
        ("2030 | 6.56 | 1.83 | 0.00 | 8.39", 10),
        ("2031 | 6.77 | 1.91 | 0.00 | 8.68", 10),
        ("2032 | 6.99 | 1.99 | 0.00 | 8.98", 10),
        ("2033 | 7.22 | 2.07 | 0.00 | 9.29", 10),
        ("2034 | 7.45 | 2.15 | 0.00 | 9.60", 10),
        ("2035 | 7.69 | 2.24 | 0.00 | 9.93", 10),
        ("2036 | 7.94 | 2.33 | 0.00 | 10.27", 10),
        ("", 12),
        ("Assumptions", 16),
        ("- Discount rate: 8.50%; inflation: 2.60%; market rent growth: 3.00%", 11),
        ("- Expense stop: base-year 2026; controllable OpEx cap: 5.00% cumulative", 11),
        ("- Parking: 120 stalls at $390/stall/month with 2.00% annual escalation", 11),
        ("", 12),
        ("Scenario Output", 16),
        ("- Base case occupancy cost / employee: $27,460 in year 1", 11),
        ("- Stress case (+150 bps inflation): PV increases by $3.2M (+5.1%)", 11),
        ("- Efficiency case (8% footprint reduction): PV decreases by $5.4M (-8.6%)", 11),
    ]


def page_risks() -> list[tuple[str, int]]:
    return [
        ("3. Risk Register and Mitigations", 24),
        ("", 10),
        ("Risk Item | Severity | Probability | Suggested Mitigation", 10),
        ("Expense passthrough drafting ambiguity | High | Medium | Tighten gross-up language", 10),
        ("HVAC after-hours pricing uncapped | Medium | Medium | Add annual cap and audit rights", 10),
        ("Assignment/sublet consent threshold | High | Low | Objective consent standard + cure", 10),
        ("Delay damages for late delivery absent | Medium | Medium | Add rent credit schedule", 10),
        ("Security deposit release triggers weak | Low | Medium | Add release test by DSCR metrics", 10),
        ("", 14),
        ("Clause Highlights", 16),
        ("- Expansion right: ROFO on floor 23 through year 4 (positive strategic optionality)", 11),
        ("- Contraction right: one-time surrender up to 12,000 RSF in year 6 with fee", 11),
        ("- Renewal option: fair-market with 95%-of-market ceiling (favorable)", 11),
        ("- Audit rights: annual; tenant recovers costs when variance exceeds 4%", 11),
        ("", 14),
        ("Overall Legal/Commercial Risk Rating: MODERATE", 16),
        (
            "Residual exposure is manageable if redline package includes capped controllables and explicit",
            11,
        ),
        ("service-level remedies for mechanical system outages.", 11),
    ]


def page_actions() -> list[tuple[str, int]]:
    return [
        ("4. Recommended Negotiation Plan", 24),
        ("", 10),
        ("Priority 1 (must-have)", 16),
        ("- Add 5.0% annual cap on controllable operating expenses, non-cumulative", 11),
        ("- Expand assignment rights for affiliate and M&A transfers", 11),
        ("- Include liquidated damages for delivery delay beyond 30 days", 11),
        ("", 12),
        ("Priority 2 (value engineering)", 16),
        ("- Increase TI allowance from $120 to $135/RSF", 11),
        ("- Extend free rent from 8 to 10 months gross", 11),
        ("- Lock parking rate for first 24 months", 11),
        ("", 12),
        ("Implementation Timeline", 16),
        ("- Week 1: redline package and landlord response matrix", 11),
        ("- Week 2: economics reopen based on TI and abatement targets", 11),
        ("- Week 3: legal closure and signature package", 11),
        ("- Week 4: construction mobilization and move-management kickoff", 11),
        ("", 12),
        ("Appendix Note", 16),
        (
            "This sample report is intentionally data-rich to demonstrate the production output format used by",
            11,
        ),
        ("Lease Deck for institutional client deliverables.", 11),
    ]


def main() -> None:
    pages = [page_cover(), page_exec_summary(), page_financials(), page_risks(), page_actions()]
    pdf = build_pdf(pages)

    out_path = Path(__file__).resolve().parents[1] / "public" / "example-report.pdf"
    out_path.write_bytes(pdf)
    print(f"Wrote {out_path} ({len(pdf)} bytes)")


if __name__ == "__main__":
    main()
