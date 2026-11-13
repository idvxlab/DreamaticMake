"""Export single-body primitive envelopes to STEP; never promote them to manufacturing CAD."""
import argparse
from hashlib import sha256
import json
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('root', type=Path)
parser.add_argument('--toolchain-dir', type=Path)
args = parser.parse_args()
args.root = args.root.resolve(strict=True)
if args.toolchain_dir: sys.path.insert(0, str(args.toolchain_dir.resolve()))
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeSphere, BRepPrimAPI_MakeCylinder
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRep import BRep_Builder
from OCP.TopoDS import TopoDS_Compound
from OCP.gp import gp_Pnt, gp_Trsf, gp_Quaternion, gp_Vec
from OCP.STEPControl import STEPControl_Writer, STEPControl_Reader, STEPControl_AsIs
from OCP.IFSelect import IFSelect_RetDone
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from element.io.components import load_component
from element.io.package import template_paths
from element.categories import Structure
from element.interfaces.geometry import Cylinder
from element.base.quantity import Quantity


def measure(shape):
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    bounds = Bnd_Box()
    BRepBndLib.Add_s(shape, bounds)
    box = bounds.Get()
    return props.Mass(), [box[i+3] - box[i] for i in range(3)]


report = {'schema_version': '1', 'unit': 'mm', 'scope': 'Assumed envelope geometry only; no manufacturing, pin or motion validation.',
          'generated': [], 'skipped': []}
candidates = [(name, path, load_component(path), report['scope'], {})
    for name, path in template_paths(args.root).items()]
for folder in sorted(args.root.iterdir()):
    source = folder / 'structured.json'
    if not source.is_file() or (folder / 'assets' / 'reference.step').exists(): continue
    data = json.loads(source.read_text(encoding='utf-8'))
    parameters = data.get('model', {}).get('parameters', {})
    keys = ('housing_diameter', 'housing_height')
    if not all(parameters.get(key, {}).get('status') == 'known' and parameters[key].get('value') for key in keys): continue
    diameter, height = [Quantity.model_validate_json(json.dumps(parameters[key]['value'])).to('m').value for key in keys]
    model = Structure.from_shape(id='reference.envelope', name=data['name'],
        shape=Cylinder(radius_m=diameter/2, length_m=height))
    scope = 'Exterior cylindrical envelope from recorded dimensions only; holes, leads, internals and tolerances are unspecified. Not manufacturing CAD.'
    candidates.append((folder.name, source, model, scope, {key: parameters[key] for key in keys}))
for name, path, model, scope, dimensions in candidates:
    geometry = model.geometry
    envelopes = [e for e in geometry.envelopes.values() if e.purpose == 'solid']
    if len(geometry.bodies) != 1 or not envelopes or any(e.shape.kind not in ('box', 'sphere', 'cylinder') for e in envelopes):
        report['skipped'].append({'template': name, 'reason': 'Requires explicit multi-body assembly or non-primitive CAD'})
        continue
    builder, compound = BRep_Builder(), TopoDS_Compound()
    builder.MakeCompound(compound)
    for envelope in envelopes:
        shape = envelope.shape
        if shape.kind == 'box':
            x, y, z = [v * 1000 for v in shape.size_m]
            solid = BRepPrimAPI_MakeBox(gp_Pnt(-x/2, -y/2, -z/2), x, y, z).Shape()
        elif shape.kind == 'sphere': solid = BRepPrimAPI_MakeSphere(shape.radius_m * 1000).Shape()
        else:
            radius, length = shape.radius_m * 1000, shape.length_m * 1000
            solid = BRepPrimAPI_MakeCylinder(radius, length).Shape()
            center = gp_Trsf()
            center.SetTranslation(gp_Vec(0, 0, -length/2))
            solid = BRepBuilderAPI_Transform(solid, center, True).Shape()
        transform = gp_Trsf()
        transform.SetRotation(gp_Quaternion(*envelope.pose.rotation_xyzw))
        transform.SetTranslationPart(gp_Vec(*[v * 1000 for v in envelope.pose.translation_m]))
        builder.Add(compound, BRepBuilderAPI_Transform(solid, transform, True).Shape())
    if not BRepCheck_Analyzer(compound).IsValid(): raise RuntimeError(name + ': invalid generated topology')
    target = path.parent / 'assets' / 'envelope.step'
    target.parent.mkdir(exist_ok=True)
    writer = STEPControl_Writer()
    if writer.Transfer(compound, STEPControl_AsIs) != IFSelect_RetDone or writer.Write(str(target)) != IFSelect_RetDone:
        raise RuntimeError(name + ': STEP export failed')
    reader = STEPControl_Reader()
    if reader.ReadFile(str(target)) != IFSelect_RetDone or not reader.TransferRoots(): raise RuntimeError(name + ': STEP import failed')
    restored = reader.OneShape()
    volume, bounds = measure(restored)
    original_volume, original_bounds = measure(compound)
    if not BRepCheck_Analyzer(restored).IsValid() or volume <= 0 or not math.isclose(volume, original_volume, rel_tol=1e-7):
        raise RuntimeError(name + ': STEP volume/topology verification failed')
    if any(not math.isclose(a, b, abs_tol=1e-5) for a, b in zip(bounds, original_bounds)):
        raise RuntimeError(name + ': STEP bounding box changed')
    detail = {'template': name, 'path': target.relative_to(args.root).as_posix(), 'sha256': sha256(target.read_bytes()).hexdigest(),
        'valid_topology': True, 'reimported': True, 'volume_mm3': volume, 'bounds_mm': bounds,
        'source_record_sha256': sha256(path.read_bytes()).hexdigest(), 'scope': scope, 'source_dimensions': dimensions}
    manifest_path = path.parent / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    manifest['supplemental_cad'] = {'path': 'assets/envelope.step', **{k: detail[k] for k in ('sha256', 'scope')}, 'unit': 'mm'}
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    report['generated'].append(detail)
(args.root / 'step_generation_report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'generated': len(report['generated']), 'skipped': len(report['skipped'])}))
