// The consumed service handles, in one place every module reads. Services
// arrive and leave on their own schedule, so nothing here is cached by the
// consumers — always read through the getter.

let execution = null;
let kernel = null;

module.exports = {
  setExecution(service) {
    execution = service;
  },
  getExecution() {
    return execution;
  },
  setKernel(service) {
    kernel = service;
  },
  getKernel() {
    return kernel;
  },
};
