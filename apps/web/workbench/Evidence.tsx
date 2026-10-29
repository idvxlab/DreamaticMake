import { assemblyResults } from "./AssemblyEvidence";
import type { Invocation, Packet } from "../../../packages/workbench/contracts";

export function ExecutionNotice({ node }: { node: Invocation }) {
  const assemblies = assemblyResults(node);
  const own = [
    ...(node.appearanceEvidence || []),
    ...(node.hardwareEvidence || []),
  ];
  const cad = own.filter(
    (p) =>
      p.evidence === "executed" &&
      p.execution &&
      ["build_appearance_geometry", "OpenCascade STEP inspection"].includes(
        p.execution.tool,
      ),
  );
  const cadCount = cad.length + assemblies.length;
  return (
    <div className="execution-states" aria-label="执行证据范围">
      <span>
        CAD / 几何：
        {cadCount
          ? `本次有 ${cadCount} 项工具产物证据`
          : "本次无工具产物证据；引用结果请查看逐件来源"}
      </span>
      <span>
        分件几何检查：
        {assemblies.length
          ? assemblies.some((r) => !r.passed)
            ? "存在检查缺口，详见执行报告"
            : "本次证据检查通过"
          : "无执行证据"}
        ；实物装配与公差未验证
      </span>
      <span>固件编译：无执行证据</span>
      <span>制造与实物：未验证</span>
      <small>
        单件几何或外形生成仅代表对应产物；当前网格能否显示由预览单独报告。
      </small>
    </div>
  );
}

export function ItemEvidence({ packet }: { packet?: Packet }) {
  const items = [
    ...new Map(packet?.data.structure.map((i) => [i.id, i]) || []).values(),
  ].filter((i) => Array.isArray(i.properties.dimensionsMm));
  return (
    <details className="item-evidence" open>
      <summary>逐件尺寸与证据 · {items.length} 项</summary>
      <p>
        尺寸按 X / Y / Z，单位
        mm；最多显示三位小数，显示舍入不代表公差，原始数据保持不变。网格显示状态见视窗。尺寸来源不代表装配、公差、电气或制造验证。
      </p>
      {items.map((item) => {
        const p = item.properties;
        const source = p.geometryRef || p.appearanceRef || p.hardwareRefs;
        const evidence =
          p.dimensionsEvidence === "step_file_bounds"
            ? "来源 STEP 文件包络"
            : p.dimensionsEvidence === "appearance_file_bounds"
              ? "工具生成的外形 CAD 包络"
              : p.designAssumption ||
                  p.reservedVolumeStatus === "designAssumption"
                ? "设计假设 / 估计预留，非来源 CAD"
                : "尺寸来源未提供 / 设计提案";
        return (
          <section key={item.id}>
            <strong>{item.label}</strong>
            <span>
              {(p.dimensionsMm as unknown[])
                .map((v) =>
                  typeof v === "number" && Number.isFinite(v)
                    ? String(Number(v.toFixed(3)))
                    : String(v),
                )
                .join(" × ")}{" "}
              mm
            </span>
            <span>{evidence}</span>
            {!!p.designAssumption && (
              <small>
                暂定依据：
                {typeof p.designAssumption === "string"
                  ? p.designAssumption
                  : JSON.stringify(p.designAssumption)}
              </small>
            )}
            <small>
              覆盖范围：
              {typeof p.geometryCoverage === "string"
                ? p.geometryCoverage
                : "未提供"}
            </small>
            {Array.isArray(p.unknownFields) && (
              <small>
                仍未知：
                {p.unknownFields
                  .filter((v) => typeof v === "string")
                  .join("、")}
              </small>
            )}
            <details>
              <summary>来源与版本</summary>
              <pre>
                {source ? JSON.stringify(source, null, 2) : "无版本化来源引用"}
              </pre>
            </details>
          </section>
        );
      })}
    </details>
  );
}
