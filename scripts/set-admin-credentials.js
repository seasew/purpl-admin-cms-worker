#!/usr/bin/env node
// Sets ADMIN_USERNAME and ADMIN_PASSWORD (bcrypt-hashed) in Cloudflare KV.
// Run: node scripts/set-admin-credentials.js

const bcrypt = require("bcryptjs");
const readline = require("readline");
const { execSync } = require("child_process");

const KV_NAMESPACE_ID = "f5220b2fa98448b394cd0e47b96cf1ad";
const SALT_ROUNDS = 10;

function prompt(rl, question) {
	return new Promise((resolve) => rl.question(question, resolve));
}

function promptPassword(question) {
	return new Promise((resolve) => {
		process.stdout.write(question);
		const chars = [];

		process.stdin.setRawMode(true);
		process.stdin.resume();
		process.stdin.setEncoding("utf8");

		function onData(ch) {
			if (ch === "\r" || ch === "\n") {
				process.stdin.setRawMode(false);
				process.stdin.pause();
				process.stdin.removeListener("data", onData);
				process.stdout.write("\n");
				resolve(chars.join(""));
			} else if (ch === "") {
				// Ctrl+C
				process.stdout.write("\n");
				process.exit(1);
			} else if (ch === "" || ch === "\b") {
				// Backspace
				if (chars.length > 0) {
					chars.pop();
					process.stdout.clearLine(0);
					process.stdout.cursorTo(0);
					process.stdout.write(question + "*".repeat(chars.length));
				}
			} else {
				chars.push(ch);
				process.stdout.write("*");
			}
		}

		process.stdin.on("data", onData);
	});
}

async function main() {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

	const username = await prompt(rl, "Admin username: ");
	rl.close();

	if (!username.trim()) {
		console.error("Error: username cannot be empty.");
		process.exit(1);
	}

	const password = await promptPassword("Admin password: ");
	const confirmPassword = await promptPassword("Confirm password: ");

	if (password !== confirmPassword) {
		console.error("Error: passwords do not match.");
		process.exit(1);
	}
	if (password.length < 8) {
		console.error("Error: password must be at least 8 characters.");
		process.exit(1);
	}

	console.log("Hashing password...");
	const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

	console.log("Writing ADMIN_USERNAME to KV...");
	execSync(
		`npx wrangler kv key put --namespace-id=${KV_NAMESPACE_ID} ADMIN_USERNAME "${username.trim()}" --remote`,
		{ stdio: "inherit" }
	);

	console.log("Writing ADMIN_PASSWORD to KV...");
	execSync(
		`npx wrangler kv key put --namespace-id=${KV_NAMESPACE_ID} ADMIN_PASSWORD "${passwordHash}" --remote`,
		{ stdio: "inherit" }
	);

	console.log("Admin credentials set successfully.");
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
