// The consumed service handles, in one place every module reads. Services
// arrive and leave on their own schedule, so nothing here is cached by the
// consumers — always read through the getter.

let execution = null;
let kernel = null;
let output = null;
const adapters = new Set();
let executionGeneration = 0;
let kernelGeneration = 0;
let outputGeneration = 0;
let lifecycleGeneration = 0;

module.exports = {
  getLifecycleGeneration() {
    return lifecycleGeneration;
  },
  invalidate() {
    lifecycleGeneration++;
  },
  setExecution(service) {
    execution = service;
    return ++executionGeneration;
  },
  clearExecution(generation) {
    if (executionGeneration === generation) execution = null;
  },
  getExecution() {
    return execution;
  },
  async requestExecution() {
    if (!execution) {
      await lumine.packages.requestService("jupyter.execution", "^1.0.0");
    }
    return execution;
  },
  setKernel(service) {
    kernel = service;
    return ++kernelGeneration;
  },
  clearKernel(generation) {
    if (kernelGeneration === generation) kernel = null;
  },
  getKernel() {
    return kernel;
  },
  async requestKernel() {
    if (!kernel) {
      await lumine.packages.requestService("jupyter.kernel", "^1.0.0");
    }
    return kernel;
  },
  setOutput(service) {
    output = service;
    return ++outputGeneration;
  },
  clearOutput(generation) {
    if (outputGeneration === generation) output = null;
  },
  getOutput() {
    return output;
  },
  async requestOutput() {
    if (!output) await lumine.packages.requestService("jupyter.output", "^1.0.0");
    return output;
  },
  addAdapter(service) {
    const edge = { service };
    adapters.add(edge);
    return () => adapters.delete(edge);
  },
  getAdapter(item) {
    for (const { service } of adapters) {
      const adapter = service.getAdapterForItem?.(item);
      if (adapter) return adapter;
    }
    return null;
  },
  clearAdapters() {
    adapters.clear();
  },
};
