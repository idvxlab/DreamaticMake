"""Derived URDF, with child-anchor rebasing over the entire instantiated forest."""
import math
import xml.etree.ElementTree as ET
from element.base.frame import Pose
from engine.design.professional import key, resolved_poses


def rpy(q):
    x, y, z, w = q
    return (math.atan2(2*(w*x+y*z), 1-2*(x*x+y*y)),
            math.asin(max(-1., min(1., 2*(w*y-z*x)))),
            math.atan2(2*(w*z+x*y), 1-2*(y*y+z*z)))


def export_urdf(p):
    if p.motion.couplings or any(p.definition(i).mechanical.couplings for i in p.index.instances):
        raise ValueError('URDF profile does not support couplings')
    poses = resolved_poses(p)
    joints, links = p.effective_joints(), p.occurrences('mechanical', 'links')
    # Generate names by stable sorted index: arbitrary slashes cannot collide.
    names = {ref: f'link_{i}' for i, ref in enumerate(sorted(links))}
    joint_names = {id: f'joint_{i}' for i, id in enumerate(sorted(joints))}
    frames = {ref: Pose() for ref in links}
    for joint in joints.values(): frames[key(joint.child)] = joint.child_origin
    robot = ET.Element('robot', name=p.manifest.id)
    ET.SubElement(robot, 'link', name='synthetic_world')
    losses = []
    def origin(parent, pose):
        ET.SubElement(parent, 'origin', xyz=' '.join(map(str, pose.translation_m)), rpy=' '.join(map(str, rpy(pose.rotation_xyzw))))
    for ref, link in links.items():
        node = ET.SubElement(robot, 'link', name=names[ref])
        if link.inertial:
            inertial = ET.SubElement(node, 'inertial')
            origin(inertial, frames[ref].inverse().compose(link.inertial.origin))
            ET.SubElement(inertial, 'mass', value=str(link.inertial.mass_kg))
            ET.SubElement(inertial, 'inertia', **{k: str(v) for k, v in link.inertial.inertia_kg_m2.model_dump().items()})
        else:
            losses.append({'object': ref, 'code': 'inertia.not_exported', 'message': 'No verified complete inertial tensor; kinematic export only'})
        for collection, tag in ((link.visuals, 'visual'), (link.collisions, 'collision')):
            for id, graphic in collection.items():
                g = graphic.geometry
                if g.type in ('capsule', 'brep', 'mesh'):
                    raise ValueError('URDF asset/tessellation adapter required: ' + ref + '/' + id)
                view = ET.SubElement(node, tag, name=id)
                origin(view, frames[ref].inverse().compose(graphic.origin))
                geometry = ET.SubElement(view, 'geometry')
                attributes = {'size': ' '.join(map(str, g.size_m))} if g.type == 'box' else {'radius': str(g.radius_m)}
                if g.type == 'cylinder': attributes['length'] = str(g.length_m)
                ET.SubElement(geometry, g.type, **attributes)
    incoming = {key(j.child) for j in joints.values()}
    for ref in links.keys() - incoming:
        node = ET.SubElement(robot, 'joint', name='root_' + names[ref], type='fixed')
        ET.SubElement(node, 'parent', link='synthetic_world')
        ET.SubElement(node, 'child', link=names[ref])
        origin(node, poses[ref])
    for id, j in joints.items():
        parent, child = key(j.parent), key(j.child)
        node = ET.SubElement(robot, 'joint', name=joint_names[id], type=j.type)
        ET.SubElement(node, 'parent', link=names[parent])
        ET.SubElement(node, 'child', link=names[child])
        origin(node, frames[parent].inverse().compose(j.origin))
        if j.axis is not None: ET.SubElement(node, 'axis', xyz=' '.join(map(str, j.axis)))
        if j.type != 'fixed':
            limit = j.limit
            if not limit or limit.velocity is None or limit.effort is None:
                raise ValueError('URDF needs_input: velocity/effort unknown for ' + id)
            if j.type != 'continuous' and (limit.lower is None or limit.upper is None):
                raise ValueError('URDF needs_input: position bounds unknown for ' + id)
            ET.SubElement(node, 'limit', **{k: str(v) for k, v in limit.model_dump().items() if v is not None})
    return {'snapshot_id': p.snapshot_id, 'xml': ET.tostring(robot, encoding='unicode'),
        'source_map': {**{name: ref for ref, name in names.items()}, **{name: id for id, name in joint_names.items()}},
        'joint_states': dict(p.motion.initial_positions), 'losses': losses,
        'coverage': ['derived URDF XML only; not urdfdom validation or dynamics']}
