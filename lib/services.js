// The consumed service handles, in one place every module reads. Services
// arrive and leave on their own schedule, so nothing here is cached by the
// consumers — always read through the getter.

let execution = null;
let kernel = null;

module.exports = {
  setExecution(service) {
    execution = service;
  },
  async requestExecution() {
    if (!execution) {
      await lumine.packages.requestService("jupyter.execution", "^1.0.0");
    }
    return execution;
  },
  setKernel(service) {
    kernel = service;
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
};
