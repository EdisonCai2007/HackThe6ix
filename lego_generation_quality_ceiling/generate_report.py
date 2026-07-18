#!/usr/bin/env python3
"""Generate the final Markdown report and complete evidence catalog."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parent
OUTLINE_PATH = ROOT / "outline.yaml"
FIELDS_PATH = ROOT / "fields.yaml"
PRELUDE_PATH = ROOT / "report_prelude.md"
REPORT_PATH = ROOT / "report.md"

CATEGORY_MAPPING = {
    "Basic Info": ["basic_info", "Basic Info"],
    "Technical Features": [
        "technical_features",
        "technical_characteristics",
        "Technical Features",
    ],
    "Performance Metrics": ["performance_metrics", "performance", "Performance Metrics"],
    "Milestone Significance": [
        "milestone_significance",
        "milestones",
        "Milestone Significance",
    ],
    "Business Info": ["business_info", "commercial_info", "Business Info"],
    "Competition & Ecosystem": [
        "competition_ecosystem",
        "competition",
        "Competition & Ecosystem",
    ],
    "History": ["history", "History"],
    "Market Positioning": ["market_positioning", "market", "Market Positioning"],
}

INTERNAL_FIELDS = {"_source_file", "uncertain"}


def slugify(value: str) -> str:
    value = re.sub(r"[^a-z0-9\s-]", "", value.lower())
    return re.sub(r"[\s-]+", "-", value).strip("-")


def humanize(value: str) -> str:
    return value.replace("_", " ").strip().title()


def traverse_for_field(value: Any, field_name: str) -> Any:
    if isinstance(value, dict):
        if field_name in value:
            return value[field_name]
        for child in value.values():
            found = traverse_for_field(child, field_name)
            if found is not None:
                return found
    elif isinstance(value, list):
        for child in value:
            found = traverse_for_field(child, field_name)
            if found is not None:
                return found
    return None


def find_field(data: dict[str, Any], category: str, field_name: str) -> Any:
    if field_name in data:
        return data[field_name]

    for category_key in CATEGORY_MAPPING.get(category, []):
        category_value = data.get(category_key)
        if isinstance(category_value, dict) and field_name in category_value:
            return category_value[field_name]

    return traverse_for_field(data, field_name)


def contains_uncertain(value: Any) -> bool:
    if isinstance(value, str):
        return "[uncertain]" in value.lower()
    if isinstance(value, dict):
        return any(contains_uncertain(child) for child in value.values())
    if isinstance(value, list):
        return any(contains_uncertain(child) for child in value)
    return False


def is_empty(value: Any) -> bool:
    return value is None or value == "" or value == [] or value == {}


def scalar(value: Any) -> str:
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if value is None:
        return ""
    return str(value).strip()


def inline_value(value: Any) -> str:
    if isinstance(value, dict):
        return "; ".join(
            f"**{humanize(str(key))}:** {inline_value(child)}"
            for key, child in value.items()
            if not is_empty(child)
        )
    if isinstance(value, list):
        return ", ".join(inline_value(child) for child in value if not is_empty(child))
    return scalar(value).replace("\n", " ")


def format_value(value: Any) -> list[str]:
    if isinstance(value, list):
        if not value:
            return []
        if all(isinstance(item, dict) for item in value):
            lines: list[str] = []
            for item in value:
                parts = [
                    f"**{humanize(str(key))}:** {inline_value(child)}"
                    for key, child in item.items()
                    if not is_empty(child)
                ]
                lines.append(f"- {'<br>'.join(parts)}")
            return lines
        if len(value) <= 3 and all(len(inline_value(item)) < 100 for item in value):
            return [", ".join(inline_value(item) for item in value)]
        return [f"- {inline_value(item)}" for item in value]

    if isinstance(value, dict):
        return [
            f"- **{humanize(str(key))}:** {inline_value(child)}"
            for key, child in value.items()
            if not is_empty(child)
        ]

    text = scalar(value)
    if not text:
        return []
    if len(text) > 100:
        return [text]
    return [text]


def confidence_summary(value: Any) -> str:
    text = inline_value(value)
    first = re.split(r"(?<=[.!?])\s+", text, maxsplit=1)[0]
    return first[:220] + ("..." if len(first) > 220 else "")


def load_results(outline: dict[str, Any]) -> list[dict[str, Any]]:
    configured = Path(outline["execution"]["output_dir"])
    output_dir = configured if configured.is_absolute() else ROOT / configured
    results = []
    for path in sorted(output_dir.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        data["_source_file"] = path.name
        results.append(data)
    return results


def main() -> None:
    outline = yaml.safe_load(OUTLINE_PATH.read_text(encoding="utf-8"))
    fields = yaml.safe_load(FIELDS_PATH.read_text(encoding="utf-8"))
    results = load_results(outline)

    lines = [PRELUDE_PATH.read_text(encoding="utf-8").rstrip(), "", "## Evidence catalog", ""]
    lines.append(
        "The catalog below is generated from every validated research packet. Fields marked uncertain "
        "by an agent are omitted; their names are listed without reproducing uncertain values."
    )
    lines.extend(["", "### Evidence-catalog contents", ""])

    for index, data in enumerate(results, 1):
        name = str(data.get("item_name", data["_source_file"]))
        category = inline_value(data.get("category", ""))
        confidence = confidence_summary(data.get("confidence", ""))
        summary = " | ".join(part for part in (category, confidence) if part)
        suffix = f" — {summary}" if summary else ""
        lines.append(f"{index}. [{name}](#{slugify(name)}){suffix}")

    defined_fields = {
        field["name"]
        for category in fields.get("field_categories", [])
        for field in category.get("fields", [])
    }
    category_keys = {
        key for values in CATEGORY_MAPPING.values() for key in values
    }

    for data in results:
        name = str(data.get("item_name", data["_source_file"]))
        uncertain = set(data.get("uncertain", []))
        lines.extend(["", f"### {name}", ""])

        for category in fields.get("field_categories", []):
            category_name = category["category"]
            rendered_fields: list[str] = []

            for field in category.get("fields", []):
                field_name = field["name"]
                value = find_field(data, category_name, field_name)
                if field_name in uncertain or is_empty(value) or contains_uncertain(value):
                    continue
                formatted = format_value(value)
                if not formatted:
                    continue
                rendered_fields.extend([f"##### {humanize(field_name)}", "", *formatted, ""])

            if rendered_fields:
                lines.extend([f"#### {category_name}", "", *rendered_fields])

        extras = {
            key: value
            for key, value in data.items()
            if key not in defined_fields
            and key not in INTERNAL_FIELDS
            and key not in category_keys
            and not is_empty(value)
            and not contains_uncertain(value)
        }
        if extras:
            lines.extend(["#### Other Info", ""])
            for key, value in extras.items():
                lines.extend([f"##### {humanize(key)}", "", *format_value(value), ""])

        if uncertain:
            lines.extend(["#### Omitted as uncertain", ""])
            lines.extend(f"- `{field_name}`" for field_name in sorted(uncertain))
            lines.append("")

    REPORT_PATH.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    print(f"Generated {REPORT_PATH} from {len(results)} validated research packets.")


if __name__ == "__main__":
    main()
