"""Workbench stage contracts over native v3 engineering types; no execution or approval."""
from process import artifacts

SPECS = {
    'appearance': ('外观设计', artifacts.AppearanceOutput, ('requirements',), (), ('requirements', 'constraints')),
    'assembly_detail': ('装配与连接深化设计', artifacts.AssemblyDetailOutput, ('requirements', 'spatial_layout', 'enclosure_detail'), ('motion_detail', 'hardware_selection'), ('enclosure_components', 'hardware_mounts', 'world_poses', 'motion', 'constraints')),
    'enclosure_detail': ('外壳组件深化设计', artifacts.EnclosureDetailOutput, ('requirements', 'spatial_layout', 'appearance'), (), ('hardware_geometry', 'world_poses', 'appearance_images', 'materials', 'constraints')),
    'hardware_selection': ('硬件选型', artifacts.HardwareSelectionOutput, ('requirements',), (), ('requirements', 'element_library', 'constraints')),
    'logical_layout': ('电路逻辑布局', artifacts.LogicalLayoutOutput, ('requirements', 'hardware_selection'), (), ('hardware_terminals', 'requirements', 'constraints')),
    'motion_detail': ('运动深化设计', artifacts.MotionDetailOutput, ('requirements', 'spatial_layout'), (), ('hardware_bodies', 'world_poses', 'joint_ranges', 'initial_configuration', 'constraints')),
    'print_optimization': ('打印件优化设计', artifacts.PrintOptimizationOutput, ('assembly_detail',), (), ('assembled_cad', 'printer', 'support_strategy', 'min_feature_m', 'resolution_m', 'constraints')),
    'procurement_assembly_guide': ('采购与装配说明', artifacts.ProcurementAssemblyGuideOutput, ('hardware_selection', 'logical_layout', 'assembly_detail', 'print_optimization'), ('requirements', 'software_design'), ('part_quantities', 'assembly_sequence', 'cad_revisions', 'verification_evidence')),
    'requirements': ('需求与功能文档', artifacts.RequirementsOutput, (), (), ('source_documents', 'constraints')),
    'software_design': ('软件工程设计', artifacts.SoftwareDesignOutput, ('requirements', 'hardware_selection', 'logical_layout'), ('motion_detail',), ('controller_instances', 'hardware_terminals', 'logical_nets', 'requirements', 'constraints')),
    'spatial_layout': ('空间布局', artifacts.SpatialLayoutOutput, ('requirements', 'hardware_selection', 'appearance'), (), ('hardware_geometry', 'appearance_images', 'world_m_xyzw', 'constraints')),
}


def describe_stage(stage):
    title, model, required, optional, keys = SPECS[stage]
    return {'process_kind': stage, 'title': title, 'category': 'workflow',
        'contract_version': 'workbench-stage/3', 'actions': ['submit'],
        'required_upstream': required, 'optional_upstream': optional, 'context_keys': keys,
        'output_schema': model.model_json_schema(),
        'limitations': ['Contract validation only; no geometry execution, approval or manufacturing claim.']}
