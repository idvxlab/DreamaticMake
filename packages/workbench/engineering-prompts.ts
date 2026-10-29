import type { Role } from "./contracts";
import { ENGINEERING_PROTOCOL } from "./engineering-protocol";

/** Only domain-relevant instructions enter a role's Pi system prompt. */
export function engineeringRoleInstructions(role: Role) {
  const domains: Partial<Record<Role, string>> = {
    embedded: `电路需要明确端子/连线时使用circuit_energy：terminal的properties={engineeringProtocol:"${ENGINEERING_PROTOCOL}",role:"signal"|"power"|"ground",voltageRange:null或{min:{value:数字,unit:"V"},max:{value:数字,unit:"V"}}}；net使用{engineeringProtocol:"${ENGINEERING_PROTOCOL}",role:"signal"|"power"|"ground",members:[实际terminal条目ID至少2个]}。例如未知额定电压的电源端子可输出{"channel":"circuit_energy","id":"supply-terminal","kind":"terminal","label":"电源输入（电压待核实）","properties":{"engineeringProtocol":"${ENGINEERING_PROTOCOL}","role":"power","voltageRange":null},"references":[]}。不能猜测引脚/电压以凑完整网络。`,
    mechanical: `确需结构连接/运动时：structure/structure-connection使用properties={engineeringProtocol:"${ENGINEERING_PROTOCOL}",a:实际body条目ID或null,b:实际body条目ID或null,constraint:"fixed"|"joint",jointRef:实际joint条目ID或null}；motion/joint使用{engineeringProtocol:"${ENGINEERING_PROTOCOL}",parentBody:实际body条目ID或null,childBody:实际body条目ID或null,jointKind:"fixed"|"revolute"|"continuous"|"prismatic",axis:[x,y,z]或null,lower:{value:数字,unit:"mm"或"deg"}或null,upper:同前或null,initial:同前或null}。转动使用deg，移动使用mm；未知轴/行程用null。现有component-instance/appearance模型仍使用原几何来源协议，不给未知kind硬套版本。`,
    software: `软件类型化I/O使用logic/logic-port，properties={engineeringProtocol:"${ENGINEERING_PROTOCOL}",direction:"in"|"out",valueType:null或{kind:"boolean"}或{kind:"scalar",unit:"单位"}或{kind:"enum",values:[选项]}或{kind:"event"|"stream",schemaId:"真实约定ID"}}；logic-binding使用{engineeringProtocol:"${ENGINEERING_PROTOCOL}",from:实际logic-port条目ID或null,to:实际logic-port条目ID或null}。例如未知类型输入为{"channel":"logic","id":"sensor-input","kind":"logic-port","label":"传感输入类型待核实","properties":{"engineeringProtocol":"${ENGINEERING_PROTOCOL}","direction":"in","valueType":null},"references":[]}。绑定仅描述声明，不执行Python或证明固件已编译/烧录。`,
  };
  const domain = domains[role];
  if (!domain) return "";
  const flow =
    role === "embedded" || role === "software"
      ? `信息或物料流确有需要时才用flow/flow-port：{engineeringProtocol:"${ENGINEERING_PROTOCOL}",direction:"in"|"out"|"bidirectional",domain:"material"|"information",required:布尔,medium:文字或null,valueType:上述类型或null}；flow-edge：{engineeringProtocol:"${ENGINEERING_PROTOCOL}",domain:"material"|"information",from:实际flow-port条目ID或null,to:[实际flow-port条目ID]}。方向、域、单位和类型须相容；没有证据时保留未知，不添加猜测线路。`
      : "";
  return `\n新输出的以下规范条目必须显式使用${ENGINEERING_PROTOCOL}；仅输出任务实际需要的通道和关系，不强制五类产满。缺少事实的规定字段填null，不删字段或默填零/原点。references和领域from/to等只引用实际输入或本次声明的条目ID，不用invocation UUID或远端record/collection/object路径。后台错误会要求修复，gap保留为未验证诊断，不能据此宣称批准或工程通过。旧硬件/BOM/外形kind保留原专用协议，不标记为本协议。\n${domain}\n${flow}`;
}
