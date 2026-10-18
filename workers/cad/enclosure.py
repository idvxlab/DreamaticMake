"""Trusted enclosure template. JSON input only; never eval/exec generated code."""
import json, sys, math
from pathlib import Path
from build123d import Box, Cylinder, Pos, Rot, Align, Compound, export_step, export_stl, import_step
import trimesh

def overlap_volume(a,b):
    intersection=a & b
    return 0 if intersection is None else intersection.volume

def build(p, out):
    for k, lo, hi in [('width',20,300),('depth',20,300),('height',12,200),('wall',1,6),('clearance',.1,2),('lid',1,6)]:
        if not isinstance(p.get(k),(int,float)) or not math.isfinite(p[k]) or not lo <= p[k] <= hi:
            raise ValueError('Invalid '+k)
    w,d,h,t,c,l=[p[k] for k in ['width','depth','height','wall','clearance','lid']]
    holes=p.get('holes',[])
    if len(holes)>12 or w<=4*t+12 or d<=4*t+12 or h<=t+l+3: raise ValueError('Invalid cavity')
    out=Path(out);out.mkdir(parents=True,exist_ok=True)
    base=Box(w,d,h-l,align=(Align.CENTER,Align.CENTER,Align.MIN))
    base-=Pos(0,0,t)*Box(w-2*t,d-2*t,h,align=(Align.CENTER,Align.CENTER,Align.MIN))
    lid=Pos(0,0,h-l)*Box(w,d,l,align=(Align.CENTER,Align.CENTER,Align.MIN))
    lip_height=min(3,(h-l-t)/3)
    lip=Pos(0,0,h-l-lip_height)*Box(w-2*t-2*c,d-2*t-2*c,lip_height,align=(Align.CENTER,Align.CENTER,Align.MIN))
    lip-=Pos(0,0,h-l-lip_height-.1)*Box(w-4*t-2*c,d-4*t-2*c,lip_height+.2,align=(Align.CENTER,Align.CENTER,Align.MIN))
    for hole in holes:
        lip-=Pos(hole['x'],hole['y'],h-l-lip_height)*Cylinder(hole['diameter']/2+2+c,lip_height,align=(Align.CENTER,Align.CENTER,Align.MIN))
    lid+=lip
    for hole in holes:
        x,y,r=hole['x'],hole['y'],hole['diameter']/2
        if not all(math.isfinite(v) for v in [x,y,r]) or r<.5 or r>7.5 or abs(x)+r+t>=w/2 or abs(y)+r+t>=d/2:raise ValueError('Invalid hole')
        boss=Pos(x,y,0)*Cylinder(r+2,h-l,align=(Align.CENTER,Align.CENTER,Align.MIN))
        base+=boss
        drill=Pos(x,y,-1)*Cylinder(r,h+2,align=(Align.CENTER,Align.CENTER,Align.MIN))
        base-=drill;lid-=drill
    for m in p.get('mounts',[]):
        x,y,diam,drill,height=[m[k] for k in ['x','y','outerDiameter','holeDiameter','height']]
        if drill>=diam-1 or abs(x)+diam/2>=w/2-t or abs(y)+diam/2>=d/2-t or t+height>=h-l:raise ValueError('Invalid board standoff')
        base+=Pos(x,y,t)*Cylinder(diam/2,height,align=(Align.CENTER,Align.CENTER,Align.MIN))
        base-=Pos(x,y,t)*Cylinder(drill/2,height+.1,align=(Align.CENTER,Align.CENTER,Align.MIN))
    for port in p.get('ports',[]):
        face,x,y,pw,ph=[port[k] for k in ['face','x','y','width','height']]
        span=d if face in ['left','right'] else w
        if abs(x)+pw/2>=span/2-t or (abs(y)+ph/2>=d/2-t if face=='lid' else y-ph/2<=t or y+ph/2>=h-l):raise ValueError('Port exceeds valid wall')
        if face in ['front','back']:
            base-=Pos(x,(-d/2 if face=='front' else d/2),y)*Box(pw,t*3,ph)
        elif face in ['left','right']:
            base-=Pos((-w/2 if face=='left' else w/2),x,y)*Box(t*3,pw,ph)
        elif face=='lid':lid-=Pos(x,y,h-l)*Box(pw,ph,2*(l+lip_height))
        else:raise ValueError('Unknown port face')
    components=p.get('components',[])
    for i,a in enumerate(components):
        if abs(a['x'])+a['width']/2>w/2-t-c or abs(a['y'])+a['depth']/2>d/2-t-c or a['z']<t or a['z']+a['height']>h-l-c:raise ValueError('Component does not fit: '+a['partId'])
        for b in components[:i]:
            if abs(a['x']-b['x'])<(a['width']+b['width'])/2 and abs(a['y']-b['y'])<(a['depth']+b['depth'])/2 and a['z']<b['z']+b['height'] and b['z']<a['z']+a['height']:raise ValueError('Component collision')
        envelope=Pos(a['x'],a['y'],a['z'])*Box(a['width'],a['depth'],a['height'],align=(Align.CENTER,Align.CENTER,Align.MIN))
        if overlap_volume(envelope,base)>0.01 or overlap_volume(envelope,lid)>0.01:raise ValueError('Component collides with enclosure: '+a['partId'])
    if not base.is_valid or not lid.is_valid:raise ValueError('Invalid BREP')
    assembly=Compound(children=[base,lid]);export_step(assembly,out/'assembly.step')
    for name,shape in [('base',base),('lid',Pos(0,0,h)*Rot(180,0,0)*lid)]:export_stl(shape,out/(name+'.stl'),tolerance=.05,angular_tolerance=.1)
    readback=import_step(out/'assembly.step')
    meshes={name:trimesh.load(str(out/(name+'.stl'))) for name in ['base','lid']}
    checks={'brep_valid':bool(base.is_valid and lid.is_valid),'step_roundtrip_valid':bool(readback.is_valid),'positive_volume':base.volume>0 and lid.volume>0,'watertight':all(m.is_watertight for m in meshes.values()),'expected_solids':len(base.solids())==1 and len(lid.solids())==1,'component_envelopes_fit':True,'enclosure_no_interference':overlap_volume(base,lid)<0.01,'height_matches_parameter':abs(readback.bounding_box().size.Z-h)<0.001,'print_parts_on_bed':all(abs(m.bounds[0][2])<.001 for m in meshes.values())}
    if not all(checks.values()):raise ValueError('Geometry checks failed: '+str(checks))
    result={'ok':True,'units':'mm','checks':checks,'volume_mm3':float(base.volume+lid.volume),'dimensions':p,'component_count':len(components),'print_orientation':{'base':'STL 已放到底面 Z=0','lid':'STL 已翻转至顶板平面 Z=0，定位边朝上','reference':'reference-component 网格不应打印'},'limitations':['通用参数化外壳；开孔、支架及部件包络仅验证已提供参数，未覆盖未建模的线缆和电气连接。','未验证部件实际安装、热学、悬垂与打印机公差；需人工检查和试装。'],'files':['assembly.step','base.stl','lid.stl','parameters.json','enclosure.py','report.json']}
    for i,a in enumerate(components):
        shape=Pos(a['x'],a['y'],a['z'])*Box(a['width'],a['depth'],a['height'],align=(Align.CENTER,Align.CENTER,Align.MIN))
        name='reference-component-'+str(i)+'.stl';export_stl(shape,out/name);result['files'].append(name)
    (out/'parameters.json').write_text(json.dumps(p,indent=2))
    (out/'enclosure.py').write_text(Path(__file__).read_text())
    (out/'report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print(json.dumps(result,ensure_ascii=False))

if __name__=='__main__':
    try:build(json.loads(sys.stdin.read()),sys.argv[1])
    except Exception as e:
        print(json.dumps({'ok':False,'error':str(e)},ensure_ascii=False));sys.exit(1)
