"""Real CAD smoke: shared shape, projection scale, non-box fit and nonconvex outlines."""
import json,sys,tempfile,subprocess
from pathlib import Path
import numpy as np
from build123d import Box,Pos,export_step,export_stl
from build_appearance import run
from geometry_views import load_part,segments,camera

root=Path(sys.argv[1]) if len(sys.argv)>1 else Path(tempfile.mkdtemp(prefix='dreamatic-appearance-'))
root.mkdir(parents=True,exist_ok=True)
design={"version":"dreamatic.appearance/1","units":"mm","geometryFrame":"xyz-mm-center-z-up/1","label":"smoke","axis":"y","wallThicknessMm":2,"sections":[{"offsetMm":-30,"centerMm":[0,40],"shape":"rounded_rectangle","sizeMm":[60,80],"radiusMm":12},{"offsetMm":0,"centerMm":[0,40],"shape":"rounded_rectangle","sizeMm":[64,84],"radiusMm":14},{"offsetMm":30,"centerMm":[0,40],"shape":"rounded_rectangle","sizeMm":[60,80],"radiusMm":12}],"features":[],"ruled":False,"bodyColor":"#e9e8e1","accentColor":"#df956d","assumptions":["test geometry"]}
report=run(design,root/'body');assert all(report['checks'].values());assert len(report['viewEvidence']['views'])==4
assert report['viewEvidence']['sameScale'] and report['viewEvidence']['orthographic']
parts=[]
for id,pos in [('inside',[0,0,40]),('corner',[29,25,3]),('overlap',[0,0,40]),('split',[0,0,40])]:
 shape=Box(80,4,4)if id=="split"else Box(4,4,4);step=root/(id+'.step');mesh=root/(id+'.stl');export_step(shape,step);export_stl(shape,mesh)
 parts.append({"id":id,"file":str(mesh),"stepFile":str(step),"bounds":{"minMm":[-40 if id=="split"else -2,-2,-2],"maxMm":[40 if id=="split"else 2,2,2]},"positionMm":pos,"rotationDeg":[0,0,0]})
job={"parts":parts,"exterior":{"id":"body","file":str(root/'body/appearance.stl')},"fit":{"shell":str(root/'body/shell.step'),"outer":str(root/'body/outer.step')},"frameBounds":[report['sceneBounds']['minMm'],report['sceneBounds']['maxMm']]}
(root/'job.json').write_text(json.dumps(job));p=subprocess.run([sys.executable,str(Path(__file__).with_name('project_layout.py')),str(root/'job.json'),str(root/'layout')],capture_output=True,text=True,check=True)
layout=json.loads(p.stdout.splitlines()[-1]);checks={p['id']:p for p in layout['fit']['parts']}
assert not checks['split']['passed'] and checks['split']['outsideOuterMm3']>0
assert checks['inside']['passed'];assert not checks['corner']['passed'],'AABB corner must fail the REAL rounded shape'
assert any(p['a']=='inside' and p['b']=='overlap' and not p['passed']for p in layout['fit']['pairs'])
assert layout['millimetersPerPixel']==report['viewEvidence']['millimetersPerPixel']
# An L shape retains its inner corner in top-view outlines; a convex hull loses it.
lshape=Box(10,10,2)-Pos(2.5,2.5,0)*Box(5,5,4);export_stl(lshape,root/'concave.stl')
mesh=load_part({'file':str(root/'concave.stl')});edges=segments(mesh,camera('top')[2]);xy=edges[:,:,:2].reshape(-1,2)
assert np.any(np.linalg.norm(xy-[0,0],axis=1)<.02),'Concave inner corner must remain'
(root/'smoke-report.json').write_text(json.dumps({'cad':report['checks'],'fit':layout['fit'],'sameScaleAcrossSets':True,'concaveSilhouetteRetained':True},indent=2))
print(json.dumps({'checks':report['checks'],'insidePass':checks['inside']['passed'],'roundedCornerReject':not checks['corner']['passed'],'overlapReject':True,'sameScaleAcrossSets':True,'concaveSilhouetteRetained':True,'output':str(root)}))
