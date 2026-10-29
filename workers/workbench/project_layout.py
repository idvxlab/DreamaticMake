"""True mesh silhouettes inside the SAME appearance shape; no hull substitution."""
import json,sys
from pathlib import Path
import numpy as np
import trimesh
from geometry_views import render_views,rotation

def volume(shape):
    if shape is None:return 0.
    if hasattr(shape,"volume"):return float(shape.volume)
    return sum(volume(part)for part in shape)

job=json.loads(Path(sys.argv[1]).read_text());out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
entries=[dict(p,role="part") for p in job["parts"]]
if job.get("exterior"):
    entries.insert(0,dict(job["exterior"],role="exterior"))
else:
    # Explicitly legacy data, never passed by the current shared-appearance pipeline.
    for i,e in enumerate(job.get("envelopes",[])):
        mesh=trimesh.creation.box(extents=e["dimensionsMm"])
        mesh.vertices=mesh.vertices@rotation(e["rotationDeg"]).T+np.asarray(e["positionMm"])
        file=out/("legacy-envelope-"+str(i)+".stl");mesh.export(file)
        entries.insert(0,{"id":"legacy-proposed-box-"+str(i),"file":str(file),"role":"exterior"})
for i,e in enumerate(job.get("reservations",[])):
    mesh=trimesh.creation.box(extents=e["dimensionsMm"])
    mesh.vertices=mesh.vertices@rotation(e["rotationDeg"]).T+np.asarray(e["positionMm"])
    file=out/("assumed-reserve-"+str(i)+".stl");mesh.export(file)
    entries.append({"id":e["id"],"file":str(file),"role":"reserve"})
if not job["parts"] or not (job.get("exterior") or job.get("envelopes")):raise ValueError("Need real parts and a source exterior")
result=render_views(entries,out,["front","top","side"],"layout",job.get("frameBounds"))
result.update({"assumedRegions":job.get("reservations",[]),"enclosureEvidence":"shared_appearance_cad" if job.get("exterior") else "legacy_proposed_box_only","assemblyVerified":False})
# CAD-based interference evidence. Component and exterior transforms match the renderer.
if job.get("fit"):
    from build123d import import_step,Pos,Compound
    from OCP.gp import gp_Trsf
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
    fit=job["fit"];shell=import_step(fit["shell"]);outer=import_step(fit["outer"]);parts=[];checks=[]
    for spec in job["parts"]:
        shape=import_step(spec["stepFile"])
        center=(np.asarray(spec["bounds"]["minMm"])+np.asarray(spec["bounds"]["maxMm"]))/2
        r=rotation(spec["rotationDeg"]);t=np.asarray(spec["positionMm"])-r@center
        transform=gp_Trsf();transform.SetValues(*[float(v) for v in np.column_stack((r,t)).flatten()])
        shape=Compound(BRepBuilderAPI_Transform(shape.wrapped,transform,True).Shape())
        if not shape.solids():raise ValueError("Source STEP contains no solids: "+spec["id"])
        shape=Compound(children=list(shape.solids()))
        # Supplier assemblies may contain intersecting solids and free edges.
        # Evaluate each solid separately: Boolean operations on overlapping
        # assembly compounds can return spurious removed/remaining volumes.
        clash=escape=0.;contacts=[]
        for solid in shape.solids():
            collision=solid&shell;outside=solid-outer
            cv=volume(collision);clash+=cv
            if cv>.001:
                pieces=[collision]if hasattr(collision,"bounding_box")else collision
                for piece in pieces:
                    bb=piece.bounding_box();contacts.append({"minMm":list(bb.min),"maxMm":list(bb.max)})
            escape+=volume(outside)
        checks.append({"id":spec["id"],"shellIntersectionMm3":clash,"contactBounds":contacts,"outsideOuterMm3":escape,"passed":clash<.1 and escape<.1});parts.append((spec["id"],shape))
    pairs=[]
    for i,(aid,a)in enumerate(parts):
        for bid,b in parts[i+1:]:
            pair_volume=0.
            for sa in a.solids():
                ba=sa.bounding_box()
                for sb in b.solids():
                    bb=sb.bounding_box()
                    if any(list(ba.max)[i]<list(bb.min)[i] or list(bb.max)[i]<list(ba.min)[i]for i in range(3)):continue
                    common=sa&sb;pair_volume+=volume(common)
            pairs.append({"a":aid,"b":bid,"intersectionMm3":pair_volume,"passed":pair_volume<.1})
    result["fit"]={"method":"STEP solid Boolean intersection/difference in shared world frame","parts":checks,"pairs":pairs,"passed":all(c["passed"] for c in checks+pairs),"toleranceMm3":.1,"scope":"only bound real CAD components; assumed reserves, assembly access, cables, tolerances and manufacturing remain unverified","assemblyVerified":False}
(out/"projection-report.json").write_text(json.dumps(result,indent=2))
print(json.dumps(result))
