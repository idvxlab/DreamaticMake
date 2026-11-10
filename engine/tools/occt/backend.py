"""STEP import with explicit mm reader target, normalised exactly once."""
import base64
from pathlib import Path
import tempfile


def probe():
    import OCP
    return {'ocp_binding': OCP.__version__, 'occt_native': 'not-exposed-by-binding'}


def execute(operation, data):
    from OCP.STEPControl import STEPControl_Reader
    from OCP.IFSelect import IFSelect_RetDone
    from OCP.TColStd import TColStd_SequenceOfAsciiString
    from OCP.BRepCheck import BRepCheck_Analyzer
    from OCP.BRepBndLib import BRepBndLib
    from OCP.Bnd import Bnd_Box
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_SOLID, TopAbs_SHELL
    reports, meshes, findings = [], [], []
    with tempfile.TemporaryDirectory() as directory:
        for index, e in enumerate(data['entries']):
            path = Path(directory)/f'{index}.step'
            path.write_bytes(base64.b64decode(data['assets'][e['geometry']['asset_ref']['sha256']], validate=True))
            reader = STEPControl_Reader()
            if reader.ReadFile(str(path)) != IFSelect_RetDone: raise ValueError('STEP read failed')
            units, angles, solids = TColStd_SequenceOfAsciiString(), TColStd_SequenceOfAsciiString(), TColStd_SequenceOfAsciiString()
            reader.FileUnits(units, angles, solids)
            names = [units.Value(i).ToCString().lower() for i in range(1, units.Length()+1)]
            aliases = {'millimetre':'mm', 'millimeter':'mm', 'metre':'m', 'meter':'m', 'centimetre':'cm', 'centimeter':'cm'}
            if not names or {aliases.get(n, n) for n in names} != {e['geometry']['unit']}:
                raise ValueError('STEP file units conflict with declared unit or mixed units are unsupported')
            reader.SetSystemLengthUnit(1.0)
            if reader.TransferRoots() < 1: raise ValueError('STEP transfer failed')
            shape = reader.OneShape()
            valid = BRepCheck_Analyzer(shape).IsValid()
            def count(t):
                it, total = TopExp_Explorer(shape, t), 0
                while it.More(): total += 1; it.Next()
                return total
            bounds = Bnd_Box(); BRepBndLib.AddOptimal_s(shape, bounds)
            props = GProp_GProps(); BRepGProp.VolumeProperties_s(shape, props)
            reports.append({'ref': e['ref'], 'valid': valid, 'solids': count(TopAbs_SOLID), 'shells': count(TopAbs_SHELL),
                'bounds_m': [v*.001 for v in bounds.Get()], 'volume_m3': props.Mass()*1e-9,
                'file_units': names, 'reader_target_unit': 'mm', 'result_unit': 'm', 'normalization_scale': .001})
            if not valid: findings.append({'code':'geometry.invalid', 'severity':'error', 'refs':[e['ref']], 'message':'OCCT shape validation failed'})
            if operation == 'tessellate':
                from OCP.BRepMesh import BRepMesh_IncrementalMesh
                from OCP.StlAPI import StlAPI_Writer
                mesh = BRepMesh_IncrementalMesh(shape, data['options']['linear_deflection_m']*1000, False, data['options']['angular_deflection_rad'], False)
                if not mesh.IsDone(): raise ValueError('STEP tessellation failed')
                stl = Path(directory)/f'{index}.stl'
                writer = StlAPI_Writer(); writer.ASCIIMode = False
                if not writer.Write(shape, str(stl)): raise ValueError('STL write failed')
                if stl.stat().st_size > 8_000_000: raise ValueError('Derived mesh budget exceeded')
                meshes.append({'ref': e['ref'], 'unit':'mm', 'data_base64':base64.b64encode(stl.read_bytes()).decode('ascii'),
                    'approximation':'tessellated', 'proven_error_bound_m':None})
    return {'execution':'completed', 'outcome':'fail' if findings else 'unknown', 'findings':findings,
        'reports':reports, 'meshes':meshes, 'coverage':['STEP validity, units, bounds and volume; no manufacturing acceptance']}
