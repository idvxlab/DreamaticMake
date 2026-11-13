# 统一库中的合成元件

安装合成模板包后，元件位于配置的 `element_pool/template_*/component.json`，配套场景为同目录
`scenario.json`，资产以各元件目录为根。输入规范见 [packages.md](packages.md)。
所有合成尺寸、额定值和标定均为软件演示假设，不是厂商参数。

库中覆盖结构、执行器、传动、光、显示、声音、人机输入、传感器、控制器、驱动器、
供电、输送、储能和基础电路器件。`template_described_*` 补充分类规格、资料来源和端子描述；
`template_custom_cad_housing` 与 `template_imported_wedge` 保留原有 STL 和来源文件。

元件构造回归资料归 `engine/tests/fixtures/build_components.py` 和
`described_components.py`；它们不会自动修改元件库。

```sh
.runtime/python/bin/python -B -m unittest engine.tests.test_components engine.tests.test_component_descriptions -v
.runtime/python/bin/python scripts/check-element-pool.py 'element_pool'
```

完整的组装案例见 [project_1](../../examples/project_1/README.md)。库记录和测试通过
不表示媒体采样、电池续航、固件或制造性能已经验证。
