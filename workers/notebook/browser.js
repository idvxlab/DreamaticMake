/* Served with a dedicated restrictive CSP. No app credentials or host filesystem. */
importScripts(new URL("runtime/pyodide.js", self.location.href).href);
self.onmessage = async ({ data }) => {
  const send = self.postMessage.bind(self);
  let count = 0;
  const log = (text) => {
    count += text.length;
    if (count > 50000) throw new Error("Python output limit exceeded");
    send({ type: "log", text });
  };
  try {
    if (
      !Array.isArray(data.cells) ||
      data.cells.length > 16 ||
      JSON.stringify(data).length > 1000000
    )
      throw new Error("Notebook input limit exceeded");
    const py = await loadPyodide({
      indexURL: new URL("runtime/", self.location.href).href,
      stdout: log,
      stderr: log,
      packages: [],
    });
    send({ type: "ready", version: py.version });
    py.globals.set("_inputs_json", JSON.stringify(data.inputs));
    py.globals.set("_snapshot_json", JSON.stringify(data.snapshot));
    py.runPython(
      "import json\ninputs = json.loads(_inputs_json)\nsnapshot = json.loads(_snapshot_json)\noutputs = {}\n",
    );
    for (const cell of data.cells) {
      if (typeof cell.code !== "string" || cell.code.length > 20000)
        throw new Error("Invalid code cell");
      await py.runPythonAsync(cell.code, { filename: `${cell.id}.py` });
    }
    const result = py.runPython(
      "import json\njson.dumps(outputs, allow_nan=False)",
    );
    if (result.length > 100000) throw new Error("Python result limit exceeded");
    send({ type: "result", outputs: JSON.parse(result), version: py.version });
  } catch (error) {
    send({ type: "error", message: String(error).slice(0, 6000) });
  }
  self.close();
};
