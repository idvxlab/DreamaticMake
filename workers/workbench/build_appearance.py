"""Trusted parametric appearance CAD: lofted true contours, hollow cavity and features."""
import json,sys,hashlib,math
from pathlib import Path
import numpy as np
from build123d import Plane,RectangleRounded,Ellipse,Circle,Solid,Compound,Pos,export_step,export_stl,import_step
from geometry_views import render_views

def boolean_volume(shape):
    """build123d booleans may return None, a Shape, or a multi-solid ShapeList."""
    if shape is None:return 0.0
    if hasattr(shape,"volume"):return float(shape.volume)
    return sum(boolean_volume(part)for part in shape)

def solid_shape(shape):
    """Keep Shape results intact; normalize ShapeList for later export/bounds calls."""
    if shape is None:raise ValueError("Appearance boolean produced no solid")
    if hasattr(shape,"is_valid") and hasattr(shape,"solids"):
        if not shape.solids():raise ValueError("Appearance boolean produced no solid")
        return shape
    parts=[solid for part in shape for solid in solid_shape(part).solids()]
    if not parts:raise ValueError("Appearance boolean produced no solid")
    return Compound(children=parts)

def plane(axis,offset,center):
    if axis=="y":return Plane(origin=(center[0],offset,center[1]),x_dir=(1,0,0),z_dir=(0,-1,0))
    if axis=="z":return Plane(origin=(center[0],center[1],offset),x_dir=(1,0,0),z_dir=(0,0,1))
    return Plane(origin=(offset,center[0],center[1]),x_dir=(0,1,0),z_dir=(1,0,0))

def profile(s,axis,inset=0):
    w,h=np.asarray(s["sizeMm"])-2*inset
    shape=Ellipse(w/2,h/2) if s["shape"]=="ellipse" else RectangleRounded(w,h,s["radiusMm"]-inset)
    return (plane(axis,s["offsetMm"],s["centerMm"])*shape).wire()

def interpolate(sections,offset):
    for a,b in zip(sections,sections[1:]):
        if a["offsetMm"]-1e-8<=offset<=b["offsetMm"]+1e-8:
            t=(offset-a["offsetMm"])/(b["offsetMm"]-a["offsetMm"])
            return {"offsetMm":offset,"centerMm":((1-t)*np.asarray(a["centerMm"])+t*np.asarray(b["centerMm"])).tolist(),"shape":a["shape"],"sizeMm":((1-t)*np.asarray(a["sizeMm"])+t*np.asarray(b["sizeMm"])).tolist(),"radiusMm":(1-t)*a["radiusMm"]+t*b["radiusMm"]}
    raise ValueError("Invalid inner section")

def bounds(shape):
    b=shape.bounding_box();return {"minMm":list(b.min),"maxMm":list(b.max)}

def run(spec,out):
    out.mkdir(parents=True,exist_ok=True);sections=spec["sections"];axis=spec["axis"];wall=spec["wallThicknessMm"]
    outer=Solid.make_loft([profile(s,axis)for s in sections],ruled=spec["ruled"])
    start,end=sections[0]["offsetMm"]+wall,sections[-1]["offsetMm"]-wall
    inner_sections=[interpolate(sections,start)]+[s for s in sections[1:-1] if start<s["offsetMm"]<end]+[interpolate(sections,end)]
    interior=Solid.make_loft([profile(s,axis,wall)for s in inner_sections],ruled=spec["ruled"])
    dz=-outer.bounding_box().min.Z;outer=Pos(0,0,dz)*outer;interior=Pos(0,0,dz)*interior
    shell=solid_shape(outer-interior);decor=[];b=outer.bounding_box()
    directions={"front":(1,1),"back":(1,-1),"right":(0,1),"left":(0,-1),"top":(2,1),"bottom":(2,-1)}
    for f in spec["features"]:
        ax,sign=directions[f["face"]];offset=list(b.max if sign>0 else b.min)[ax]
        a="xyz"[ax];p=plane(a,offset,f["centerMm"]);w,h=f["sizeMm"];r=min(f["radiusMm"],min(w,h)/2-.001)
        circular=f["kind"]=="button" and abs(w-h)<.001 and f["radiusMm"]>=w/2-.01
        face=(p*(Circle(w/2)if circular else RectangleRounded(w,h,max(.001,r)))).face()
        clearance=f.get("openingClearanceMm",.2)if f["kind"]=="button"else 0
        cut_face=(p*(Circle(w/2+clearance)if circular else RectangleRounded(w+2*clearance,h+2*clearance,max(.001,r+clearance)))).face()
        direction=[0,0,0];direction[ax]=-sign*wall*5
        start_face=Pos(*[sign*wall*2 if i==ax else 0 for i in range(3)])*cut_face
        cutter=Solid.extrude(start_face,direction)
        common=shell&cutter
        if boolean_volume(common)<1e-5:raise ValueError("Feature misses exterior: "+f["id"])
        shell=solid_shape(shell-cutter)
        outward=[0,0,0];outward[ax]=sign*(f["protrusionMm"] if f["kind"]=="button" else .35)
        if f["kind"]=="port":
            inset=[0,0,0];inset[ax]=-sign*wall*.75
            face=Pos(*inset)*face
        detail=Solid.extrude(face,outward)
        decor.append((f["id"],detail,f.get("color")or(spec["accentColor"]if f["kind"]=="button"else"#17221e")))
    scene=Compound(children=[shell]+[s for _,s,_ in decor])
    checks={"outerValid":bool(outer.is_valid),"interiorValid":bool(interior.is_valid),"shellValid":bool(shell.is_valid),"positiveVolumes":outer.volume>interior.volume>0 and shell.volume>0,"singleShellSolid":len(shell.solids())==1}
    if not all(checks.values()):raise ValueError("Appearance CAD checks failed: "+str(checks))
    entries=[]
    for name,shape in [("outer",outer),("interior",interior),("shell",shell),("appearance",scene)]:
        export_step(shape,out/(name+".step"));export_stl(shape,out/(name+".stl"),tolerance=.12,angular_tolerance=.12)
        if not import_step(out/(name+".step")).is_valid:raise ValueError("STEP roundtrip failed: "+name)
    checks["stepRoundtripValid"]=True
    entries.append({"id":"shell","file":str(out/"shell.stl"),"color":spec["bodyColor"]})
    for name,shape,color in decor:
        file=out/("feature-"+name+".stl");export_stl(shape,file,tolerance=.08,angular_tolerance=.1);entries.append({"id":name,"file":str(file),"color":color})
    scene_bounds=bounds(scene)
    views=render_views(entries,out,["front","top","side","perspective"],"appearance",[scene_bounds["minMm"],scene_bounds["maxMm"]])
    files=[p for p in out.iterdir()if p.suffix in[".step",".stl",".png"]]
    assets=[{"id":p.name,"sha256":hashlib.sha256(p.read_bytes()).hexdigest(),"bytes":p.stat().st_size}for p in files]
    report={"version":"dreamatic.appearance/1","bodyBounds":bounds(shell),"sceneBounds":bounds(scene),"outerBounds":bounds(outer),"cavityBounds":bounds(interior),"worldZNormalizationMm":dz,"checks":checks,"assets":assets,"viewEvidence":views,"physicalVerified":False,"assemblyVerified":False,"limitations":["参数化放样外形，不是照片的精确三维重建","外形和内腔是当前设计几何；壁厚是名义值，未完成装配分件、公差与制造验证"]}
    (out/"report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2));return report

if __name__=="__main__":
    report=run(json.loads(Path(sys.argv[1]).read_text()),Path(sys.argv[2]));print(json.dumps(report,ensure_ascii=False))
