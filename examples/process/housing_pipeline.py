"""Print an offline housing request or execute it into an unpersisted candidate."""
import argparse
import json
from pathlib import Path
from element.categories import CADHousing
from element.io.components import load_component
from element.base.frame import Pose
from engine.design import make_package, snapshot_id
from engine.design.bom import derive_bom
from process import (MechanicalDetailProcess, MechanicalDetailInput, MechanicalDetailRequest, build_candidate)


def make_request():
    root = Path(__file__).resolve().parents[2]
    model = load_component(root / 'examples/element/custom_cad_housing.json')
    housing = CADHousing.model_validate_json(model.model_dump_json())
    design = make_package(design_id='housing_demo', title='Custom housing integration')
    return MechanicalDetailRequest.for_design(design, request_id='housing_demo',
        input=MechanicalDetailInput(action='integrate_parts', housing=housing, pose=Pose()),
        write_record_ids=('housing_selection',))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--request', action='store_true')
    args = parser.parse_args()
    request = make_request()
    if args.request:
        print(request.model_dump_json(indent=2))
        return
    result = MechanicalDetailProcess().run(request)
    if result.status != 'completed':
        raise RuntimeError(result.model_dump_json())
    candidate = build_candidate(request.base.design, result.proposals[0],
        write_record_ids=request.scope.write_record_ids)
    print(json.dumps({'status': result.status, 'candidate_snapshot_id': snapshot_id(candidate.manifest),
        'material': candidate.elements[0].model.cad_housing.material.name,
        'bom': derive_bom(candidate), 'persisted': False}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
