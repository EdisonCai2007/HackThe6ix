import json

import numpy as np

from training.autolabel_sam import (
    MaskProposal,
    _predict_masks,
    filter_proposals,
    masks_to_yolo_instances,
    write_review_sidecar,
)


def test_two_touching_masks_remain_two_yolo_instances():
    masks = np.zeros((2, 100, 100), dtype=bool)
    masks[0, 10:30, 10:40] = True
    masks[1, 10:30, 40:70] = True

    instances = masks_to_yolo_instances(masks, (100, 100))

    assert len(instances) == 2
    assert all(instance.class_id == 0 for instance in instances)


def test_filter_removes_nested_stud_but_keeps_adjacent_piece():
    workspace = np.ones((100, 100), dtype=bool)
    piece = np.zeros_like(workspace)
    piece[10:50, 10:50] = True
    stud = np.zeros_like(workspace)
    stud[20:28, 20:28] = True
    adjacent = np.zeros_like(workspace)
    adjacent[10:50, 50:80] = True

    kept, decisions = filter_proposals([
        MaskProposal(piece, 0.98, "piece"),
        MaskProposal(stud, 0.99, "stud"),
        MaskProposal(adjacent, 0.97, "adjacent"),
    ], workspace)

    assert {proposal.proposal_id for proposal in kept} == {"piece", "adjacent"}
    rejected = {decision["proposal_id"]: decision["reason"] for decision in decisions
                if not decision["accepted"]}
    assert rejected["stud"] == "nested_subpart"


def test_filter_rejects_mask_mostly_outside_workspace():
    workspace = np.zeros((100, 100), dtype=bool)
    workspace[:, :50] = True
    outside = np.zeros_like(workspace)
    outside[10:60, 45:95] = True

    kept, decisions = filter_proposals([
        MaskProposal(outside, 0.95, "outside")
    ], workspace, min_workspace_overlap=0.75)

    assert kept == []
    assert decisions[0]["reason"] == "workspace_overlap"


def test_autolabel_sidecar_is_never_verified_by_default(tmp_path):
    label_path = tmp_path / "x.txt"

    sidecar = write_review_sidecar(
        label_path,
        proposals=[{"proposal_id": "one", "score": 0.9}],
        checkpoint="sam2.1_s.pt",
        settings={"device": "mps"},
    )
    data = json.loads(sidecar.read_text())

    assert data["status"] == "unverified"
    assert data["annotation_source"] == "sam2.1_s.pt"
    assert data["reviewer"] is None
    assert data["proposals"][0]["proposal_id"] == "one"


def test_predict_adapter_passes_only_public_ultralytics_config_keys():
    class Result:
        masks = None
        boxes = None

    class Model:
        def predict(self, **kwargs):
            unsupported = {"points_stride", "stability_score_thresh"} & set(kwargs)
            assert not unsupported
            return [Result()]

    settings = {
        "imgsz": 1024,
        "iou": 0.70,
        "sam_generate_conf_thres": 0.88,
        "sam_generate_points_stride": 32,
        "sam_generate_stability_score_thresh": 0.95,
    }

    proposals, elapsed = _predict_masks(
        Model(), np.zeros((32, 32, 3), np.uint8), "cpu", settings
    )

    assert proposals == []
    assert elapsed >= 0
