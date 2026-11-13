"""Four-state logic and ideal, reference-aware supply checks; not a circuit solver."""


def resolve_logic(drivers, pulls=()):
    """drivers: (0/1/X/Z, push_pull/open_drain). Pulls are weak ideal fixtures."""
    strong = set()
    uncertain_open_drain = False
    for value, kind in drivers:
        if value not in ("0", "1", "X", "Z"):
            return "X"
        if value == "Z" or (kind == "open_drain" and value == "1"):
            continue
        if value == "X" and kind == "open_drain":
            uncertain_open_drain = True
            continue
        strong.add(value)
    if "X" in strong or len(strong) > 1:
        return "X"
    if uncertain_open_drain:
        if strong == {"0"}:
            return "0"
        if strong or any(p == "up" for p in pulls):
            return "X"
        return "0" if "down" in pulls else "X"
    if strong:
        return next(iter(strong))
    weak = {"1" if p == "up" else "0" for p in pulls if p != "none"}
    return next(iter(weak)) if len(weak) == 1 else "X" if weak else "Z"


def supply_valid(ir, terminal_key):
    terminal = ir.objects[terminal_key].spec
    net_key = ir.terminal_nets.get(terminal_key)
    net = ir.nets.get(net_key)
    if not net or net.spec.kind != "power" or not terminal.reference_terminal:
        return None
    scope = ir.objects[terminal_key].scope
    reference = "/".join((*scope, "terminals", terminal.reference_terminal))
    ground = ir.terminal_nets.get(reference)
    if not ground or ir.nets[ground].spec.kind != "ground":
        return None
    if net.spec.reference_net:
        expected = net_key.rsplit("/nets/", 1)[0] + "/nets/" + net.spec.reference_net if "/nets/" in net_key else "nets/" + net.spec.reference_net
        if expected != ground:
            return False
    sources = [(m, ir.objects[m]) for m in net.members if ir.objects[m].spec.electrical_role == "power_out"]
    if len(sources) != 1:
        return None
    _, source = sources[0]
    if not source.spec.nominal_voltage or not source.spec.reference_terminal or not terminal.voltage_limits:
        return None
    source_ref = "/".join((*source.scope, "terminals", source.spec.reference_terminal))
    if ir.terminal_nets.get(source_ref) != ground:
        return False
    return terminal.voltage_limits.contains(source.spec.nominal_voltage)
