"""Read a supplied STEP with OpenCascade. No code or archive from the library is executed."""
import json
import sys
from OCP.STEPControl import STEPControl_Reader
from OCP.IFSelect import IFSelect_RetDone
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.StlAPI import StlAPI_Writer
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_SOLID

reader = STEPControl_Reader()
if reader.ReadFile(sys.argv[1]) != IFSelect_RetDone:
    raise ValueError("STEP read failed")
reader.SetSystemLengthUnit(1.0)  # OpenCascade target length unit: mm
if not reader.TransferRoots():
    raise ValueError("STEP transfer failed")
shape = reader.OneShape()
if shape.IsNull():
    raise ValueError("Empty STEP")
box = Bnd_Box()
BRepBndLib.AddOptimal_s(shape, box, False, False)
if box.IsVoid() or box.IsOpen():
    raise ValueError("Unbounded STEP")
bounds = box.Get()
minimum, maximum = list(bounds[:3]), list(bounds[3:])
dimensions = [maximum[i] - minimum[i] for i in range(3)]
if not all(0 < d < 1e7 for d in dimensions):
    raise ValueError("Invalid model bounds")
explorer, solids = TopExp_Explorer(shape, TopAbs_SOLID), 0
while explorer.More():
    solids += 1
    explorer.Next()
BRepMesh_IncrementalMesh(shape, 0.25, False, 0.4, True).Perform()
writer = StlAPI_Writer()
if not writer.Write(shape, sys.argv[2]):
    raise ValueError("Mesh export failed")
print(json.dumps({"minMm": minimum, "maxMm": maximum, "dimensionsMm": dimensions, "solidCount": solids, "shapeValid": bool(BRepCheck_Analyzer(shape).IsValid())}))
