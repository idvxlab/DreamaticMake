"""Real feature-boolean regression with synthetic fixtures; no physical validation."""
import sys,json,copy,hashlib,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import build_appearance as worker
from build123d import Box
root=Path(sys.argv[1]) if len(sys.argv)>1 else Path(tempfile.mkdtemp(prefix='dreamatic-features-'))
root.mkdir(parents=True,exist_ok=True)
spec={'version':'dreamatic.appearance/1','units':'mm','geometryFrame':'xyz-mm-center-z-up/1','label':'nonempty-feature-smoke','axis':'y','wallThicknessMm':2,'sections':[{'offsetMm':n,'centerMm':[0,40],'shape':'rounded_rectangle','sizeMm':[60,80],'radiusMm':12}for n in [-30,30]],'ruled':False,'bodyColor':'#e9e8e1','accentColor':'#df956d','features':[{'id':'button','kind':'button','face':'front','centerMm':[-10,40],'sizeMm':[6,6],'radiusMm':3,'protrusionMm':1.2,'openingClearanceMm':.2},{'id':'port','kind':'port','face':'front','centerMm':[10,40],'sizeMm':[12,6],'radiusMm':1,'protrusionMm':1.2}],'assumptions':['Synthetic feature geometry; not physical verification']}
(root/'input.json').write_text(json.dumps(spec,indent=2))
types=[];original=worker.boolean_volume
def observed(shape):
 types.append(type(shape).__name__)
 return original(shape)
worker.boolean_volume=observed
report=worker.run(spec,root/'features')
assert all(report['checks'].values())
assert (root/'features/feature-button.stl').exists() and (root/'features/feature-port.stl').exists()
feature_types=types.copy();worker.boolean_volume=original
bad=copy.deepcopy(spec);bad['features']=[{**spec['features'][1],'id':'miss','centerMm':[400,40]}]
try:worker.run(bad,root/'miss')
except ValueError as error:
 assert 'Feature misses exterior: miss' in str(error)
 miss=str(error)
else:raise AssertionError('Off-shell feature accepted')
multi=Box(10,2,2).solid()-Box(2,4,4).solid()
assert type(multi).__name__=='ShapeList' and abs(original(multi)-32)<1e-6
normalized=worker.solid_shape(multi)
assert normalized.is_valid and len(normalized.solids())==2 and abs(normalized.volume-32)<1e-6
assert original(None)==0
try:worker.solid_shape(None)
except ValueError:pass
else:raise AssertionError('Empty boolean accepted')
overlap=copy.deepcopy(spec)
overlap['features'].append({**spec['features'][1],'id':'cross-existing-port','sizeMm':[20,3]})
types.clear();worker.boolean_volume=observed
cross_report=worker.run(overlap,root/'overlap-features')
worker.boolean_volume=original
assert all(cross_report['checks'].values())
assert 'ShapeList' in types,types
(root/'overlap-input.json').write_text(json.dumps(overlap,indent=2))
cross_types=types.copy()
summary={'features':['button','port'],'featureBooleanTypes':feature_types,'overlapFeatureBooleanTypes':cross_types,'allCADChecksPassed':all(report['checks'].values()),'missRejected':miss,'multiSolidBooleanType':type(multi).__name__,'multiSolidVolumeMm3':original(multi),'normalizedSolidCount':len(normalized.solids()),'generatorSha256':hashlib.sha256(Path(worker.__file__).read_bytes()).hexdigest(),'physicalVerified':False}
(root/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary))
