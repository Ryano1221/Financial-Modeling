"""
Generate sample multi-scenario deck fixtures:
1) default theCREmodel
2) broker white-label
3) client branded

Usage:
  cd backend
  python3 scripts/generate_report_deck_fixtures.py
"""
from __future__ import annotations

from datetime import date
from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from engine.compute import compute_cashflows
from models import OpexMode, RentStep, Scenario
from reporting.deck_builder import build_report_deck_html, render_report_deck_pdf


OUT_DIR = Path(__file__).resolve().parents[1] / "reports" / "fixtures"


def _entry(name: str, rsf: float, rates: list[float], notes: str, doc_type: str) -> dict:
    rent_steps = []
    start = 0
    for rate in rates:
        end = start + 11
        rent_steps.append(RentStep(start=start, end=end, rate_psf_yr=rate))
        start = end + 1
    if start < 60:
        rent_steps.append(RentStep(start=start, end=59, rate_psf_yr=rates[-1]))

    scenario = Scenario(
        name=name,
        rsf=rsf,
        commencement=date(2026, 1, 1),
        expiration=date(2031, 1, 1),
        rent_steps=rent_steps,
        free_rent_months=3,
        ti_allowance_psf=25.0,
        opex_mode=OpexMode.NNN,
        base_opex_psf_yr=10.0,
        base_year_opex_psf_yr=10.0,
        opex_growth=0.03,
        discount_rate_annual=0.08,
        notes=notes,
    )
    scenario_json = scenario.model_dump(mode="json")
    scenario_json["document_type_detected"] = doc_type
    _, result = compute_cashflows(scenario)
    return {"scenario": scenario_json, "result": result.model_dump()}


def _sample_report_payload() -> dict:
    scenarios = [
        _entry(
            "Eastlake at Tillery Building 1 Suite 1100",
            5900,
            [38.0, 39.14, 40.31, 41.52, 42.77],
            "Renewal option for 5 years; ROFR applies; OpEx excludes capital expenditures.",
            "proposal",
        ),
        _entry(
            "Eastbound 3232 E Cesar Chavez Suite 2-380",
            3226,
            [42.0, 43.26, 44.56, 45.90, 47.28],
            "ROFO language present; termination right after year 3 with fee; parking ratio 4.5/1,000 RSF.",
            "counter proposal",
        ),
        _entry(
            "500 Congress Avenue Suite 110",
            12500,
            [45.0, 46.35, 47.74, 49.17, 50.65],
            "Assignment with consent; one 3-year renewal option; controllable OpEx cap at 5%.",
            "lease",
        ),
    ]
    return {"scenarios": scenarios}


def _write_fixture(name: str, payload: dict) -> None:
    html = build_report_deck_html(payload)
    html_path = OUT_DIR / f"{name}.html"
    html_path.write_text(html, encoding="utf-8")

    try:
        pdf = render_report_deck_pdf(payload)
    except Exception as exc:  # pragma: no cover - local tooling fallback
        print(f"[fixture] {name}: PDF generation skipped ({exc})")
        return

    pdf_path = OUT_DIR / f"{name}.pdf"
    pdf_path.write_bytes(pdf)
    print(f"[fixture] wrote {pdf_path}")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    base = _sample_report_payload()

    default_payload = {
        **base,
        "branding": {
            "client_name": "Client",
            "broker_name": "theCREmodel",
            "date": date.today().isoformat(),
            "market": "Austin",
            "submarket": "CBD",
        },
    }
    broker_payload = {
        **base,
        "branding": {
            "brandName": "Summit Brokerage",
            "client_name": "Harbor Capital",
            "preparedByName": "Taylor Smith",
            "preparedByTitle": "Executive Managing Director",
            "preparedByCompany": "Summit Brokerage",
            "preparedByEmail": "taylor.smith@summitbrokerage.com",
            "preparedByPhone": "+1 (512) 555-0199",
            "primaryColor": "#111111",
            "headerText": "Institutional Tenant Advisory",
            "footerText": "Summit Brokerage · Confidential",
            "date": date.today().isoformat(),
            "market": "Austin",
            "submarket": "Urban Core",
            "disclaimerOverride": "Prepared exclusively for Harbor Capital. Verify all assumptions and legal terms prior to execution.",
        },
    }
    client_payload = {
        **base,
        "branding": {
            "brandName": "Harbor Capital",
            "client_name": "Harbor Capital Investment Committee",
            "preparedByName": "Jordan Lee",
            "preparedByTitle": "Portfolio Strategy",
            "preparedByCompany": "Harbor Capital",
            "preparedByEmail": "jordan.lee@harborcapital.com",
            "preparedByPhone": "+1 (646) 555-0141",
            "headerText": "Internal Investment Review",
            "footerText": "Harbor Capital · Internal Use",
            "date": date.today().isoformat(),
            "market": "Austin",
            "submarket": "East Austin",
            "disclaimerOverride": "For internal underwriting review only. Not for external distribution.",
        },
    }

    _write_fixture("deck-default-thecremodel", default_payload)
    _write_fixture("deck-broker-whitelabel", broker_payload)
    _write_fixture("deck-client-branded", client_payload)
    print(f"[fixture] complete. Outputs in {OUT_DIR}")


if __name__ == "__main__":
    main()
