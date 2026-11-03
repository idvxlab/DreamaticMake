import { buildModel } from "./kernel";
self.onmessage = (event: MessageEvent<string>) => {
  try {
    self.postMessage({ result: buildModel(event.data) });
  } catch (error) {
    self.postMessage({ error: (error as Error).message });
  }
};
