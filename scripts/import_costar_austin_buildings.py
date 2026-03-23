from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd


TYPE_BLOCK = """export type AustinOfficeBuildingSeed = {
  id: string;
  clientId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  market: string;
  submarket: string;
  ownerName: string;
  propertyType: string;
  totalRSF: number;
  notes: string;
  buildingClass: string;
  buildingStatus: string;
  yearBuilt: number | null;
  yearRenovated: number | null;
  numberOfStories: number | null;
  coreFactor: number | null;
  typicalFloorSize: number | null;
  parkingRatio: number | null;
  operatingExpenses: string;
  amenities: string;
  propertyId: string;
  ownerPhone: string;
  propertyManagerName: string;
  propertyManagerPhone: string;
  leasingCompanyName: string;
  leasingCompanyContact: string;
  leasingCompanyPhone: string;
  latitude: number | null;
  longitude: number | null;
  source: string;
};
"""


COLUMN_MAP = {
    "longitude": "Longitude",
    "latitude": "Latitude",
    "submarket": "Submarket Name",
    "property_type": "Property Type",
    "name": "Property Name",
    "address": "Property Address",
    "city": "City",
    "state": "State",
    "market": "Market Name",
    "building_status": "Building Status",
    "year_built": "Year Built",
    "year_renovated": "Year Renovated",
    "building_class": "Building Class",
    "stories": "Number Of Stories",
    "core_factor": "Core Factor",
    "rba": "RBA",
    "amenities": "Amenities",
    "typical_floor_size": "Typical Floor Size",
    "operating_expenses": "Building Operating Expenses",
    "parking_ratio": "Parking Ratio",
    "owner_name": "Owner Name",
    "owner_phone": "Owner Phone",
    "property_manager_name": "Property Manager Name",
    "property_manager_phone": "Property Manager Phone",
    "leasing_company_name": "Leasing Company Name",
    "leasing_company_contact": "Leasing Company Contact",
    "leasing_company_phone": "Leasing Company Phone",
    "property_id": "PropertyID",
}


def clean_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and pd.isna(value):
        return ""
    return str(value).strip()


def clean_number(value: object) -> float | int | None:
    if value is None:
        return None
    if isinstance(value, float) and pd.isna(value):
        return None
    text = clean_text(value).replace(",", "")
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    if number.is_integer():
        return int(number)
    return round(number, 6)


def build_record(row: pd.Series, source_note: str) -> dict[str, object]:
    property_id = clean_text(row[COLUMN_MAP["property_id"]])
    fallback_slug = clean_text(row[COLUMN_MAP["name"]]).lower().replace(" ", "_")
    return {
        "id": f"costar_{property_id or fallback_slug}",
        "clientId": "market_inventory_austin",
        "name": clean_text(row[COLUMN_MAP["name"]]),
        "address": clean_text(row[COLUMN_MAP["address"]]),
        "city": clean_text(row[COLUMN_MAP["city"]]),
        "state": clean_text(row[COLUMN_MAP["state"]]),
        "market": clean_text(row[COLUMN_MAP["market"]]),
        "submarket": clean_text(row[COLUMN_MAP["submarket"]]),
        "ownerName": clean_text(row[COLUMN_MAP["owner_name"]]),
        "propertyType": clean_text(row[COLUMN_MAP["property_type"]]),
        "totalRSF": clean_number(row[COLUMN_MAP["rba"]]) or 0,
        "notes": "Imported from CoStar Austin office inventory export.",
        "buildingClass": clean_text(row[COLUMN_MAP["building_class"]]),
        "buildingStatus": clean_text(row[COLUMN_MAP["building_status"]]),
        "yearBuilt": clean_number(row[COLUMN_MAP["year_built"]]),
        "yearRenovated": clean_number(row[COLUMN_MAP["year_renovated"]]),
        "numberOfStories": clean_number(row[COLUMN_MAP["stories"]]),
        "coreFactor": clean_number(row[COLUMN_MAP["core_factor"]]),
        "typicalFloorSize": clean_number(row[COLUMN_MAP["typical_floor_size"]]),
        "parkingRatio": clean_number(row[COLUMN_MAP["parking_ratio"]]),
        "operatingExpenses": clean_text(row[COLUMN_MAP["operating_expenses"]]),
        "amenities": clean_text(row[COLUMN_MAP["amenities"]]),
        "propertyId": property_id,
        "ownerPhone": clean_text(row[COLUMN_MAP["owner_phone"]]),
        "propertyManagerName": clean_text(row[COLUMN_MAP["property_manager_name"]]),
        "propertyManagerPhone": clean_text(row[COLUMN_MAP["property_manager_phone"]]),
        "leasingCompanyName": clean_text(row[COLUMN_MAP["leasing_company_name"]]),
        "leasingCompanyContact": clean_text(row[COLUMN_MAP["leasing_company_contact"]]),
        "leasingCompanyPhone": clean_text(row[COLUMN_MAP["leasing_company_phone"]]),
        "latitude": clean_number(row[COLUMN_MAP["latitude"]]),
        "longitude": clean_number(row[COLUMN_MAP["longitude"]]),
        "source": source_note,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Austin office building seed data from a CoStar export.")
    parser.add_argument("input", nargs="+", type=Path, help="One or more paths to CoStar xlsx exports")
    parser.add_argument("output", type=Path, help="Path to write the generated TypeScript module")
    args = parser.parse_args()

    source_note = f"CoStar exports provided by user: {', '.join(path.name for path in args.input)}"

    frames: list[pd.DataFrame] = []
    for input_path in args.input:
        workbook = pd.read_excel(input_path, sheet_name=0)
        filtered = workbook[
            workbook[COLUMN_MAP["city"]].astype(str).str.strip().str.lower().eq("austin")
            & workbook[COLUMN_MAP["state"]].astype(str).str.strip().str.upper().eq("TX")
            & workbook[COLUMN_MAP["property_type"]].astype(str).str.contains("office", case=False, na=False)
            & workbook[COLUMN_MAP["building_class"]].astype(str).str.strip().str.upper().isin(["A", "B"])
        ].copy()
        filtered["__source_file"] = input_path.name
        filtered["__dedupe_key"] = filtered[COLUMN_MAP["property_id"]].apply(clean_text)
        blank_property_id = filtered["__dedupe_key"].eq("")
        filtered.loc[blank_property_id, "__dedupe_key"] = filtered.loc[blank_property_id].apply(
            lambda row: "|".join([
                clean_text(row[COLUMN_MAP["name"]]).lower(),
                clean_text(row[COLUMN_MAP["address"]]).lower(),
                clean_text(row[COLUMN_MAP["submarket"]]).lower(),
            ]),
            axis=1,
        )
        frames.append(filtered)

    combined = pd.concat(frames, ignore_index=True)
    combined = combined.drop_duplicates("__dedupe_key", keep="first")
    combined = combined.sort_values([COLUMN_MAP["submarket"], COLUMN_MAP["building_class"], COLUMN_MAP["name"], COLUMN_MAP["address"]], na_position="last")
    records = [build_record(row, source_note) for _, row in combined.iterrows()]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(records, indent=2, ensure_ascii=True)
    content = "\n".join([
        "// Auto-generated from a user-provided CoStar export. Run scripts/import_costar_austin_buildings.py to refresh.",
        TYPE_BLOCK.rstrip(),
        f"export const AUSTIN_OFFICE_BUILDING_SOURCE = {json.dumps(', '.join(str(path) for path in args.input))};",
        f"export const AUSTIN_OFFICE_BUILDING_COUNT = {len(records)};",
        "export const austinOfficeBuildings: AustinOfficeBuildingSeed[] = " + payload + ";",
        "",
    ])
    args.output.write_text(content)


if __name__ == "__main__":
    main()
