import json

from training.evaluate_sessions import (
    SessionEvaluation,
    summarize_by_split,
    write_report,
)


def _evaluation(session_id, split, expected, fused):
    return SessionEvaluation(
        session_id=session_id,
        split=split,
        environment="fixture",
        detector="seg",
        expected_count=expected,
        view_count=3,
        raw_detection_count=expected * 3,
        accepted_detection_count=expected * 3,
        per_view_accepted=[expected, expected, expected],
        fused_count=fused,
        inventory_count=fused,
        unknown_count=0,
        partial_count=0,
        selected_coverage=1.0,
        union_coverage=1.0,
    )


def test_report_never_combines_test_with_train_seen():
    evaluations = [
        _evaluation("train", "train", 8, 8),
        _evaluation("val", "val", 7, 6),
        _evaluation("test", "test", 11, 11),
    ]

    report = summarize_by_split(evaluations)

    assert set(report) == {
        "train_seen", "validation", "test_environment"
    }
    assert [row["session_id"] for row in report["train_seen"]["sessions"]] == [
        "train"
    ]
    assert [row["session_id"] for row in report["test_environment"]["sessions"]] == [
        "test"
    ]
    assert report["validation"]["exact_count_sessions"] == 0


def test_report_writes_machine_and_human_readable_split_sections(tmp_path):
    evaluations = [
        _evaluation("train", "train", 8, 8),
        _evaluation("test", "test", 11, 11),
    ]

    json_path, markdown_path = write_report(evaluations, tmp_path)

    payload = json.loads(json_path.read_text())
    assert payload["splits"]["train_seen"]["session_count"] == 1
    assert payload["splits"]["test_environment"]["session_count"] == 1
    markdown = markdown_path.read_text()
    assert "## Train seen" in markdown
    assert "## Test environment" in markdown
    assert "TRAIN-SEEN" in markdown
