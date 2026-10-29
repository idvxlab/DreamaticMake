"""Deterministic views of the SAME triangle geometry; no image-model inference."""
import numpy as np
import math
import trimesh
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection, LineCollection

def rotation(degrees):
    x,y,z=np.radians(degrees);cx,sx,cy,sy,cz,sz=math.cos(x),math.sin(x),math.cos(y),math.sin(y),math.cos(z),math.sin(z)
    return np.array([[1,0,0],[0,cx,-sx],[0,sx,cx]]) @ np.array([[cy,0,sy],[0,1,0],[-sy,0,cy]]) @ np.array([[cz,-sz,0],[sz,cz,0],[0,0,1]])

def camera(view):
    direction={"front":[0,1,0],"top":[0,0,1],"side":[1,0,0],"perspective":[1.6,2.8,1.7]}[view]
    d=np.asarray(direction,dtype=float);d/=np.linalg.norm(d)
    up=np.asarray([0,1,0] if view=="top" else [0,0,1],dtype=float)
    right=np.cross(-d,up);right/=np.linalg.norm(right);up=np.cross(d,right)
    return right,up,d

def load_part(spec):
    mesh=trimesh.load(spec["file"],force="mesh",process=True)
    if not len(mesh.vertices) or len(mesh.faces)>2000000:raise ValueError("Invalid mesh")
    if spec.get("bounds"):
        center=(np.asarray(spec["bounds"]["minMm"])+np.asarray(spec["bounds"]["maxMm"]))/2
        mesh.vertices=(mesh.vertices-center)@rotation(spec["rotationDeg"]).T+np.asarray(spec["positionMm"])
    return mesh

def segments(mesh,direction,creases=True):
    edges=mesh.edges_sorted
    unique,inv,count=np.unique(edges,axis=0,return_inverse=True,return_counts=True)
    facing=np.repeat(np.asarray(mesh.face_normals)@direction>1e-7,3)
    front=np.bincount(inv,weights=facing.astype(int),minlength=len(unique))
    selected=unique[((front>0)&(front<count))|(count==1)]
    if creases and len(mesh.face_adjacency_edges):
        sharp=mesh.face_adjacency_edges[mesh.face_adjacency_angles>np.deg2rad(35)]
        selected=np.vstack([selected,sharp])
    return mesh.vertices[selected]

def render_views(entries,out,views,mode="appearance",frame_bounds=None):
    meshes=[(spec,load_part(spec)) for spec in entries]
    points=np.vstack([m.vertices for _,m in meshes])
    lo,hi=points.min(axis=0),points.max(axis=0)
    if frame_bounds is not None:lo,hi=np.asarray(frame_bounds[0]),np.asarray(frame_bounds[1])
    center=(lo+hi)/2
    # One physical scale for ALL four views, also reused by layout. Include the
    # projected box corners so the axonometric silhouette cannot be cropped.
    corners=np.asarray([[x,y,z]for x in [lo[0],hi[0]]for y in [lo[1],hi[1]]for z in [lo[2],hi[2]]])
    span=max(20,max(float(np.abs((corners-center)@np.stack(camera(v)[:2],axis=1)).max())*2 for v in ["front","top","side","perspective"]))*1.10
    result=[]
    for view in views:
        right,up,direction=camera(view);basis=np.stack([right,up],axis=1)
        c=center@basis;fig,ax=plt.subplots(figsize=(8,8),dpi=128)
        fig.patch.set_facecolor("white");view_bounds=[]
        if mode=="appearance":
            triangles=[];colors=[];depth=[]
            light=np.asarray([.35,.55,1.]);light/=np.linalg.norm(light)
            for spec,mesh in meshes:
                tri=mesh.triangles;normals=mesh.face_normals
                facing=(normals@direction)>1e-8;tri=tri[facing];normals=normals[facing]
                rgb=np.asarray(matplotlib.colors.to_rgb(spec.get("color","#e9e8e1")))
                shade=.68+.32*np.maximum(normals@light,0)
                triangles.extend(tri@basis);colors.extend(np.clip(shade[:,None]*rgb[None,:],0,1));depth.extend(tri.mean(axis=1)@direction)
            order=np.argsort(depth);collection=PolyCollection(np.asarray(triangles)[order],facecolors=np.asarray(colors)[order],edgecolors="none",antialiased=False)
            ax.add_collection(collection)
        else:
            for spec,mesh in meshes:
                s=segments(mesh,direction,creases=spec.get("role")!="exterior")
                if len(s):
                    projected=s@basis
                    keep=np.linalg.norm(projected[:,1]-projected[:,0],axis=1)>1e-5
                    ax.add_collection(LineCollection(projected[keep],colors="#b38b5a" if spec.get("role")=="reserve" else "#829084" if spec.get("role")=="exterior" else "#252525",linestyles="dashed" if spec.get("role")=="reserve" else "solid",linewidths=.8 if spec.get("role")=="exterior" else .55))
        for spec,mesh in meshes:
            p=mesh.vertices@basis;view_bounds.append({"id":spec["id"],"min":p.min(axis=0).tolist(),"max":p.max(axis=0).tolist()})
        ax.set_xlim(c[0]-span/2,c[0]+span/2);ax.set_ylim(c[1]-span/2,c[1]+span/2);ax.set_aspect("equal");ax.axis("off")
        fig.subplots_adjust(left=.02,right=.98,bottom=.02,top=.98);fig.savefig(out/(view+".png"),facecolor="white");plt.close(fig)
        result.append({"view":view,"right":right.tolist(),"up":up.tolist(),"cameraDirection":direction.tolist(),"projectedBounds":view_bounds})
    return {"views":result,"sameScale":True,"orthographic":True,"millimetersPerPixel":span/(1024*.96),"geometryBounds":{"minMm":lo.tolist(),"maxMm":hi.tolist()},"method":"shared triangle geometry with fixed orthographic camera bases; mesh silhouettes, no convex hull substitution"}
