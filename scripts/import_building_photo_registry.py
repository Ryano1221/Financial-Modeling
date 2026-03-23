from __future__ import annotations

import argparse
import csv
from pathlib import Path

HEADER = """export type AustinBuildingPhotoRegistryEntry = {
  buildingId: string;
  propertyId: string;
  preferredName?: string;
  imagePath: string;
  sourceUrl: string;
  sourceLabel: string;
  sourcePageTitle: string;
  sourceLang: string;
  description: string;
  aliases?: string[];
};
"""


def esc(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a local Austin building photo registry TS file from CSV.")
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    rows = []
    with args.input.open(newline="", encoding="utf-8") as handle:
      reader = csv.DictReader(handle)
      for row in reader:
        rows.append(row)

    lines = [
      "// Auto-generated local building photo registry. Refresh with scripts/import_building_photo_registry.py.",
      HEADER.rstrip(),
      "export const austinBuildingPhotoRegistry: AustinBuildingPhotoRegistryEntry[] = [",
    ]
    for row in rows:
      aliases = [item.strip() for item in (row.get("aliases") or "").split("|") if item.strip()]
      lines.extend([
        "  {",
        f'    buildingId: "{esc(row.get("buildingId", ""))}",',
        f'    propertyId: "{esc(row.get("propertyId", ""))}",',
        f'    preferredName: "{esc(row.get("preferredName", ""))}",',
        f'    imagePath: "{esc(row.get("imagePath", ""))}",',
        f'    sourceUrl: "{esc(row.get("sourceUrl", ""))}",',
        f'    sourceLabel: "{esc(row.get("sourceLabel", ""))}",',
        f'    sourcePageTitle: "{esc(row.get("sourcePageTitle", ""))}",',
        f'    sourceLang: "{esc(row.get("sourceLang", ""))}",',
        f'    description: "{esc(row.get("description", ""))}",',
        f'    aliases: [{", ".join(f"\"{esc(alias)}\"" for alias in aliases)}],',
        "  },",
      ])
    lines.append("];\n")
    args.output.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
