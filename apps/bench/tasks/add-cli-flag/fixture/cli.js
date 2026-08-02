import { formatGreeting } from "./format.js";

const args = process.argv.slice(2);
const name = args[0] ?? "stranger";
console.log(formatGreeting(name));
