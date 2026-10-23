"""Read an immutable STEP copy with OpenCascade; report mechanical bounds only."""
import hashlib
import json
import math
from pathlib import Path
import sys


def inspect(path,request):
    from build123d import import_step
    shape=import_step(path)
    bb=shape.bounding_box()
    minimum=[bb.min.X,bb.min.Y,bb.min.Z];maximum=[bb.max.X,bb.max.Y,bb.max.Z]
    size=[maximum[i]-minimum[i] for i in range(3)]
    if not all(math.isfinite(v) and v>=0 for v in size) or max(size)<=0:raise ValueError('Empty/nonfinite STEP bounds')
    checks={'stepReadable':True,'brepValid':bool(shape.is_valid),'hasSolids':len(shape.solids())>0}
    envelope=request.get('availableEnvelopeMm');clearance=float(request.get('clearanceMm',0))
    if envelope is not None:
        if not isinstance(envelope,list) or len(envelope)!=3 or not all(isinstance(v,(int,float)) and math.isfinite(v) and 0<v<=2000 for v in envelope):raise ValueError('Invalid available envelope')
        if not math.isfinite(clearance) or not 0<=clearance<=50:raise ValueError('Invalid clearance')
        checks['axisAlignedEnvelopeFit']=all(size[i]+2*clearance<=envelope[i] for i in range(3))
    return {'operation':'official_step_bounds','units':'mm','sha256':hashlib.sha256(Path(path).read_bytes()).hexdigest(),'boundsMin':minimum,'boundsMax':maximum,'sizeMm':dict(zip(('x','y','z'),size)),'solidCount':len(shape.solids()),'checks':checks,'availableEnvelopeMm':envelope,'clearanceMm':clearance,'geometryVerified':False,'physicalFitVerified':False,'electricalCompatibilityVerified':False,'mountingVerified':False,'limitations':['坐标轴沿用原始 STEP，不自动旋转或将板面尺寸重排。','包络比较仅是轴对齐空间检查，不包含实际装配碰撞、安装孔、公差、散热或线缆插拔空间。','未将模型转换为行为／电路仿真契约；不能据此声称产品功能或实物装配已验证。']}


if __name__=='__main__':
    try:
        folder=Path(sys.argv[1]);request=json.loads(sys.stdin.read(10000))
        result=inspect(folder/'hardware.step',request)
        (folder/'report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
        print(json.dumps({'ok':True}))
    except Exception as e:
        print(json.dumps({'ok':False,'error':str(e)},ensure_ascii=False));sys.exit(1)
