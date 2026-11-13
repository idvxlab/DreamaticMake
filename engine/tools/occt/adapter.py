"""Select whole native BReps, without accepting executable selection expressions."""
def entries(source):
    for instance, node in source.unit_occurrences().items():
        for link_id, link in source.definition(instance).mechanical.links.items():
            for role in ('visuals', 'collisions'):
                for id, graphic in getattr(link, role).items():
                    if graphic.geometry.type != 'brep': continue
                    if graphic.geometry.selection: raise NotImplementedError('STEP subshape selection requires a supported selection profile')
                    yield {'ref': f'{instance}/links/{link_id}/{role}/{id}', 'body': f'{instance}/links/{link_id}',
                        'owner': instance, 'document': node.location.path,
                        'pointer': node.pointer + '/mechanical/links/' + link_id + '/' + role + '/' + id,
                        **graphic.model_dump(mode='json')}
