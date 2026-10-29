"""Real CAD smoke, synthetic fixtures only; no supplier/physical verification."""
import json,sys,hashlib
from pathlib import Path
from build123d import Box,Cylinder,Pos,Compound,export_step
from build_assembly import run,volume
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
outer=Box(60,50,30);inner=Pos(0,0,1)*Box(56,46,28);shell=outer-inner
# Cylindrical mounting and stops are added by worker, not stand-in hardware boxes.
component=Pos(0,0,-4)*Cylinder(4,2)
for name,shape in [('outer',outer),('shell',shell),('component',component)]:export_step(shape,out/(name+'.step'))
def sha(name):return hashlib.sha256((out/(name+'.step')).read_bytes()).hexdigest()
ref={'source':'curated','recordId':'synthetic-fixture','revision':'a'*64,'assetId':'fixture.step','sha256':sha('component')}
d={'version':'dreamatic.assembly-design/1','units':'mm','geometryFrame':'xyz-mm-center-z-up/1','appearanceRef':{'modelId':'123e4567-e89b-42d3-a456-426614174000','revision':'b'*64},'shellSha256':sha('shell'),'outerSha256':sha('outer'),'instances':[{'id':'module','geometryRef':ref,'translationMm':[0,0,0],'rotationDeg':[0,0,0]}],'split':{'axis':'z','atMm':5,'gapMm':.4},'mounts':[{'id':'support','kind':'mount','centerMm':[0,0],'baseZMm':-14.5,'topZMm':-5,'radiusMm':3,'holeRadiusMm':1,'instanceId':'module'},{'id':'stop','kind':'stop','centerMm':[6,0],'baseZMm':-14.5,'topZMm':-4,'radiusMm':2,'holeRadiusMm':0,'instanceId':'module'}],'keepouts':[{'id':'wire','kind':'wire','centerMm':[0,10,-5],'sizeMm':[20,3,3],'assumption':'Synthetic straight routing corridor'}],'print':{'bedMm':[100,100,100],'material':'PLA assumption','clearanceAssumption':'Nominal split .4mm; not measured'},'assemblyOrder':['Place module on declared supports','Route harness within keepout','Position lid at original world coordinates; fastening unimplemented']}
job={'design':d,'assets':{'shellFile':str(out/'shell.step'),'outerFile':str(out/'outer.step'),'instances':{'module':str(out/'component.step')}}}
r=run(job,out/'good');assert r['geometryChecksPassed'],json.dumps(r)
assert len(r['parts'])==2 and len(r['assets'])==6 and all(m['anchoredToBase'] for m in r['mounts'])
assert all(all(abs(a+b)<1e-9 for a,b in zip(p['printTranslationMm'],p['reassemblyTranslationMm'])) for p in r['parts'])
# Actual multi-solid boolean returns ShapeList under this toolchain; volume handles it.
multi=Box(10,2,2).solid()-Box(2,4,4).solid()
assert not hasattr(multi,'volume'),type(multi)
assert len(multi)==2 and abs(volume(multi)-32)<1e-6
bad=json.loads(json.dumps(job));bad['design']['keepouts'][0]['centerMm']=[0,0,-6]
assert not run(bad,out/'blocked-wire')['geometryChecksPassed']
bad=json.loads(json.dumps(job));bad['design']['print']['bedMm']=[10,10,10]
assert not run(bad,out/'small-bed')['geometryChecksPassed']
bad=json.loads(json.dumps(job));bad['design']['instances'][0]['translationMm']=[28,0,0]
assert not run(bad,out/'collision')['geometryChecksPassed']
print(json.dumps({'goodChecksPassed':True,'blockedWireRejected':True,'smallBedRejected':True,'collisionRejected':True,'shapeListType':type(multi).__name__,'shapeListVolumeMm3':volume(multi),'report':str(out/'good/report.json')}))

# Explicit closure: two asymmetrically separated pin/socket pairs and two screw columns.
closed=json.loads(json.dumps(job))
closed['design']['closure']={'assumption':'Nominal PLA clearance; assumed M3 self-tapping screws, no thread strength claim','locators':[{'id':f'pin-{n}','centerMm':[26,y],'pinRadiusMm':1.5,'bossRadiusMm':3.5,'anchorDepthMm':3,'engagementMm':3,'radialClearanceMm':.2,'axialClearanceMm':.3,'roofMm':1} for n,y in enumerate([-14,14])],'fasteners':[{'id':f'screw-{n}','centerMm':[-26,y],'baseZMm':-14.5,'bossRadiusMm':3.5,'pilotRadiusMm':1.25,'screwRadiusMm':1.5,'clearanceRadiusMm':1.8,'headRadiusMm':3,'source':{'basis':'assumed','reference':'M3x16 nominal self-tapping screw; supplier drawing and physical fit not verified'},'pilotDepthMm':8,'screwLengthMm':16,'minEngagementMm':4,'tipClearanceMm':.5} for n,y in enumerate([-14,14])]}
closed['design']['keepouts'].append({'id':'connector','kind':'connector','centerMm':[0,-10,-5],'sizeMm':[8,4,3],'assumption':'Assumed connector envelope, insertion path not checked'})
r=run(closed,out/'closure-good');assert r['geometryChecksPassed'],json.dumps(r)
assert r['closure']['passed'] and all(p['measuredMinClearanceMm']>.19 for p in r['closure']['locators'])
assert all(f['axialEngagementMm']>=4 and f['nominalHeadBearingAreaMm2']>0 for f in r['closure']['fasteners'])
bad=json.loads(json.dumps(closed));bad['design']['closure']['fasteners'][0]['screwLengthMm']=8
assert not run(bad,out/'short-screw')['geometryChecksPassed']
bad=json.loads(json.dumps(closed));bad['design']['closure']['locators'][0]['centerMm']=[0,0]
assert not run(bad,out/'floating-locator')['geometryChecksPassed']
print(json.dumps({'closurePositivePassed':True,'shortScrewRejected':True,'floatingLocatorRejected':True,'report':str(out/'closure-good/report.json')}))

bad=json.loads(json.dumps(closed));bad['design']['keepouts'][1]['centerMm']=[26,-14,7]
assert not run(bad,out/'blocked-connector')['geometryChecksPassed']
bad=json.loads(json.dumps(closed));bad['design']['closure']['locators'][1]['centerMm']=bad['design']['closure']['locators'][0]['centerMm']
try: run(bad,out/'duplicate-locator')
except ValueError as error: assert 'overlap' in str(error)
else: raise AssertionError('Duplicate locator positions accepted')
print(json.dumps({'blockedConnectorRejected':True,'duplicateLocatorRejected':True}))
