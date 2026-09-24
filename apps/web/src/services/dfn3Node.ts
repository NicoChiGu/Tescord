import { DtlnWorkletNode, loadDtlnWorklet } from "./dtlnNode.js";

/** Stateful DeepFilterNet3 ONNX inference, with a browser or native backend. */
export class Dfn3WorkletNode extends DtlnWorkletNode {
  constructor(context: BaseAudioContext) {
    super(context, "dfn3");
  }
}

export const loadDfn3Worklet = loadDtlnWorklet;
