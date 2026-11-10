import pytest


@pytest.mark.parametrize("values,expected", [
    ((False, False, False, False, False), "capture_coverage"),
    ((True, False, False, False, False), "workspace_view_selection"),
    ((True, True, False, False, False), "segmentation"),
    ((True, True, True, False, False), "geometry_fusion"),
    ((True, True, True, True, False), "identification_evidence"),
    ((True, True, True, True, True), "no_failure"),
])
def test_failure_attribution_order(values, expected):
    from pipeline.attribution import FailureEvidence, attribute_failure

    assert attribute_failure(FailureEvidence(*values)) == expected
