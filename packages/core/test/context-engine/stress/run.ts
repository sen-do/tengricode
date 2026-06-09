import { runStressTest } from "./harness"

const report = runStressTest()
console.log(JSON.stringify(report, null, 2))
