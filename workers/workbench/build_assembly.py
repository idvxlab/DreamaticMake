"""Bounded Z-plane assembly split. All geometry comes from pinned source STEP.
No printing, screw engagement, routing physics or real assembly is asserted.
"""
import json, sys, hashlib, math
from importlib.metadata import version
from pathlib import Path
from build123d import import_step, export_step, export_stl, Box, Cylinder, Pos, Rot, Compound

def volume(shape):
    if shape is None: return 0.0
    if hasattr(shape, 'volume'): return float(shape.volume)
    return sum(volume(s) for s in shape)

def solids(shape):
    if shape is None: return []
    if hasattr(shape, 'solids'): return list(shape.solids())
    return [s for child in shape for s in solids(child)]

def normalized(shape):
    items=solids(shape)
    if not items: raise ValueError('Boolean result has no solids')
    return Compound(children=items)

def pinned(file, digest):
    file=Path(file)
    if hashlib.sha256(file.read_bytes()).hexdigest()!=digest: raise ValueError('Source STEP digest mismatch')
    shape=import_step(file)
    if not solids(shape) or not shape.is_valid or volume(shape)<=0: raise ValueError('Invalid source solid')
    return normalized(shape)

def dimensions(shape):
    b=shape.bounding_box();return [b.max.X-b.min.X,b.max.Y-b.min.Y,b.max.Z-b.min.Z]

def run(job,out):
    out=Path(out);out.mkdir(parents=True,exist_ok=True)
    d=job['design'];a=job['assets']
    if d['version']!='dreamatic.assembly-design/1' or d['units']!='mm' or d['geometryFrame']!='xyz-mm-center-z-up/1': raise ValueError('Unsupported assembly contract')
    shell=pinned(a['shellFile'],d['shellSha256']);outer=pinned(a['outerFile'],d['outerSha256'])
    b=shell.bounding_box();z=d['split']['atMm'];gap=d['split']['gapMm'];lo=z-gap/2;hi=z+gap/2
    if not b.min.Z<lo<hi<b.max.Z: raise ValueError('Split outside shell')
    dx,dy,dz=dimensions(shell);cx=(b.min.X+b.max.X)/2;cy=(b.min.Y+b.max.Y)/2
    bottom=normalized(shell & (Pos(cx,cy,(b.min.Z+lo)/2)*Box(dx+2,dy+2,lo-b.min.Z)))
    top=normalized(shell & (Pos(cx,cy,(hi+b.max.Z)/2)*Box(dx+2,dy+2,b.max.Z-hi)))
    mounts=[];mount_shapes=[]
    for m in d['mounts']:
        if m['topZMm']>=lo or m['topZMm']<=m['baseZMm'] or m['holeRadiusMm']>=m['radiusMm']: raise ValueError('Invalid mount dimensions')
        x,y=m['centerMm'];height=m['topZMm']-m['baseZMm'];cz=(m['topZMm']+m['baseZMm'])/2
        boss=Pos(x,y,cz)*Cylinder(m['radiusMm'],height)
        anchored=volume(bottom & boss)>1e-5
        if m['holeRadiusMm']>0:
            boss=normalized(boss-(Pos(x,y,cz)*Cylinder(m['holeRadiusMm'],height+2)))
        bottom=normalized(bottom+boss)
        mount_shapes.append(boss)
        mounts.append({**m,'id':m['id'],'instanceId':m['instanceId'],'kind':m['kind'],'anchoredToBase':anchored,'holeRadiusMm':m['holeRadiusMm']})
    closure={'provided':bool(d.get('closure')),'locators':[],'fasteners':[],'passed':False}
    locator_shapes=[]
    cylinder=lambda x,y,start,end,r: Pos(x,y,(start+end)/2)*Cylinder(r,end-start)
    if d.get('closure'):
        c=d['closure']
        if len(c['locators'])<2 or len(c['fasteners'])<2: raise ValueError('Closure requires two locators and two fasteners')
        closure_rows=c['locators']+c['fasteners']
        for n,p in enumerate(closure_rows):
            for q in closure_rows[n+1:]:
                if math.dist(p['centerMm'],q['centerMm'])<=p['bossRadiusMm']+q['bossRadiusMm']: raise ValueError('Closure features overlap')
        for p in c['locators']:
            x,y=p['centerMm'];r=p['pinRadiusMm'];sr=r+p['radialClearanceMm'];br=p['bossRadiusMm']
            tip=hi+p['engagementMm'];roof=tip+p['axialClearanceMm']+p['roofMm']
            if not (br>sr>r>0 and p['anchorDepthMm']>0 and p['engagementMm']>0 and p['axialClearanceMm']>0): raise ValueError('Invalid locator geometry')
            foot=cylinder(x,y,lo-p['anchorDepthMm'],lo,br)
            pin=cylinder(x,y,lo-p['anchorDepthMm'],tip,r)
            socket=cylinder(x,y,hi,roof,br)
            bore=cylinder(x,y,hi-.1,tip+p['axialClearanceMm'],sr)
            lower_anchor=volume(bottom & foot)>1e-5
            upper_anchor=volume(top & socket)>1e-5
            bottom=normalized(bottom+foot+pin)
            top=normalized((top+socket)-bore)
            locator_shapes.append((p,pin))
            closure['locators'].append({'id':p['id'],'baseAnchored':lower_anchor,'lidAnchored':upper_anchor,'nominalEngagementMm':p['engagementMm'],'nominalRadialClearanceMm':p['radialClearanceMm'],'nominalAxialClearanceMm':p['axialClearanceMm']})
        for f in c['fasteners']:
            x,y=f['centerMm'];br=f['bossRadiusMm'];pr=f['pilotRadiusMm'];cr=f['clearanceRadiusMm'];sr=f['screwRadiusMm']
            if not (0<pr<sr<cr<br and f['baseZMm']<lo and 0<f['pilotDepthMm']<lo-f['baseZMm']): raise ValueError('Invalid fastening geometry')
            lower=cylinder(x,y,f['baseZMm'],lo,br)
            upper=cylinder(x,y,hi,b.max.Z,br)
            pilot=cylinder(x,y,lo-f['pilotDepthMm'],lo+.1,pr)
            through=cylinder(x,y,hi-.1,b.max.Z+.1,cr)
            lower_anchor=volume(bottom & lower)>1e-5;upper_anchor=volume(top & upper)>1e-5
            bottom=normalized((bottom+lower)-pilot);top=normalized((top+upper)-through)
            tip=b.max.Z-f['screwLengthMm'];engagement=lo-tip
            actual_tip_clearance=tip-(lo-f['pilotDepthMm'])
            shank=cylinder(x,y,hi,b.max.Z,sr)
            # Pilot thread interference is intentional, reported separately; no thread solid is claimed.
            lid_collision=volume(shank & top)
            head_bearing=volume(cylinder(x,y,b.max.Z-.01,b.max.Z,f['headRadiusMm']) & top)/.01
            closure['fasteners'].append({'id':f['id'],'source':f['source'],'nominalHeadBearingAreaMm2':head_bearing,'baseAnchored':lower_anchor,'lidAnchored':upper_anchor,'axialEngagementMm':engagement,'tipClearanceMm':actual_tip_clearance,'radialThroughClearanceMm':cr-sr,'lidShankIntersectionMm3':lid_collision,'nominalThreadInterferenceMm':sr-pr,'passed':lower_anchor and upper_anchor and engagement>=f['minEngagementMm'] and actual_tip_clearance>=f['tipClearanceMm'] and lid_collision<.01 and head_bearing>1e-3})
        for row,(p,pin) in zip(closure['locators'],locator_shapes):
            clash=volume(pin & top);distance=float(pin.distance_to(top))
            row.update({'pinLidIntersectionMm3':clash,'measuredMinClearanceMm':distance,'passed':row['baseAnchored'] and row['lidAnchored'] and clash<.01 and distance>=min(p['radialClearanceMm'],p['axialClearanceMm'])-1e-5})
        closure['passed']=all(r['passed'] for r in closure['locators']+closure['fasteners'])
    pieces={'base':bottom,'lid':top};components=[]
    for i in d['instances']:
        source=pinned(a['instances'][i['id']],i['geometryRef']['sha256'])
        shape=Pos(*i['translationMm'])*Rot(*i['rotationDeg'])*source
        components.append((i['id'],shape))
    for m,shape in zip(mounts,mount_shapes):
        target=next((part for id,part in components if id==m['instanceId']),None)
        if target is None: raise ValueError('Mount target missing from complete instances')
        distance=float(shape.distance_to(target))
        m.update({'distanceToTargetMm':distance,'targetContactAtNominal':distance<.05})
    checks=[]
    for name,shape in pieces.items():
        valid=bool(shape.is_valid) and len(solids(shape))==1 and volume(shape)>0
        size=dimensions(shape);bed=d['print']['bedMm'];fits=all(v<=limit for v,limit in zip(size,bed))
        bb=shape.bounding_box();translation=[-(bb.min.X+bb.max.X)/2,-(bb.min.Y+bb.max.Y)/2,-bb.min.Z]
        printable=Pos(*translation)*shape
        export_step(shape,out/(name+'-assembly.step'));export_step(printable,out/(name+'.step'));export_stl(printable,out/(name+'.stl'))
        roundtrip=import_step(out/(name+'.step'))
        checks.append({'partId':name,'validSingleSolid':valid,'positiveVolumeMm3':volume(shape),'printBoundsMm':size,'fitsBedInDeclaredOrientation':fits,'printTranslationMm':translation,'reassemblyTranslationMm':[-v for v in translation],'stepRoundtripValid':bool(roundtrip.is_valid) and len(solids(roundtrip))==1})
    interference=[]
    for id,shape in components:
        clash=sum(volume(shape & part) for part in pieces.values())
        escape=sum(volume(s-outer) for s in solids(shape))
        interference.append({'instanceId':id,'shellIntersectionMm3':clash,'outsideOuterMm3':escape,'passed':clash<.01 and escape<.01})
    pairs=[]
    for n,(aid,sa) in enumerate(components):
        for bid,sb in components[n+1:]:
            v=volume(sa & sb);pairs.append({'a':aid,'b':bid,'intersectionMm3':v,'passed':v<.01})
    keepouts=[]
    for k in d['keepouts']:
        shape=Pos(*k['centerMm'])*Box(*k['sizeMm'])
        clashes=[{'partId':id,'intersectionMm3':volume(shape & part)} for id,part in [*pieces.items(),*components]]
        outside=volume(shape-outer)
        keepouts.append({'id':k['id'],'kind':k['kind'],'assumption':k['assumption'],'intersections':clashes,'outsideOuterMm3':outside,'passed':outside<.01 and all(c['intersectionMm3']<.01 for c in clashes)})
    outside_shell=volume(bottom-outer)+volume(top-outer)
    v=volume(bottom & top)
    assets=[{'id':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in sorted(out.iterdir()) if p.suffix in ('.step','.stl')]
    report={'generatorSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'toolchain':{'build123d':version('build123d')},'design':d,'version':d['version'],'appearanceRef':d['appearanceRef'],'sourceShellSha256':d['shellSha256'],'sourceOuterSha256':d['outerSha256'],'checkedInstanceIds':[i for i,_ in components],'parts':checks,'mounts':mounts,'instances':interference,'componentPairs':pairs,'keepouts':keepouts,'closure':closure,'split':{'axis':'z','atMm':z,'nominalGapMm':gap,'generatedOutsideOuterMm3':outside_shell,'reassembledIntersectionMm3':v,'passed':v<.01},'printAssumptions':d['print'],'assemblyOrder':d['assemblyOrder'],'assets':assets,'geometryChecksPassed':all(c['validSingleSolid'] and c['fitsBedInDeclaredOrientation'] and c['stepRoundtripValid'] for c in checks) and all(m['anchoredToBase'] and m['targetContactAtNominal'] for m in mounts) and all(c['passed'] for c in interference+pairs+keepouts) and v<.01 and outside_shell<.01 and (not closure['provided'] or closure['passed']),'physicalVerified':False,'printed':False,'assemblyVerified':False,'gaps':['Nominal pin/socket and screw/pilot engagement geometry only; screw threads, torque, retention strength and physical assembly unverified','Wire bend radii, connector insertion paths and assembly sequence accessibility unverified','Print support, warping, shrinkage, layer strength and measured tolerances unverified','Keepouts are explicit assumed envelopes; clearance and mounting contact checked at nominal coordinates only',('Closure not provided: no lid locating/fastening features generated' if not closure['provided'] else 'Pin/socket locating and screw clearance/pilot features generated; fasteners are sourced/assumed external parts, not supplied or physically tested')]}
    (out/'report.json').write_text(json.dumps(report,indent=2));return report

if __name__=='__main__':
    print(json.dumps(run(json.loads(Path(sys.argv[1]).read_text()),sys.argv[2])))
