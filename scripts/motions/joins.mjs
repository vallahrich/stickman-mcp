import { writeJoinMatrix } from "../film/joins.mjs";
await writeJoinMatrix({ check: process.argv.includes("--check") });
if (!process.argv.includes("--check")) console.log("Updated motions/join-matrix.json");
