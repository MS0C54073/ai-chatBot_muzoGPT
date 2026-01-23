import { createThread, saveMessage, getThreads, getMessagesByThread } from "../src/lib/db";
import { getRange, updateCell, explainFormula } from "../src/lib/tools/xlsx";
import { getDb } from "../src/lib/db/client";

async function runCheck() {
    console.log("Starting System Check...");

    // 1. Database Check
    console.log("[DB] Testing connection...");
    const db = getDb();
    if (!db) throw new Error("Failed to get DB instance");
    console.log("[DB] Connected.");

    console.log("[DB] Creating thread...");
    const thread = await createThread({ title: "Test Thread" });
    console.log(`[DB] Thread created: ${thread.id}`);

    console.log("[DB] Saving message...");
    await saveMessage({
        threadId: thread.id,
        role: "user",
        content: "Hello World",
    });
    console.log("[DB] Message saved.");

    console.log("[DB] Reading messages...");
    const messages = await getMessagesByThread(thread.id);
    if (messages.length !== 1 || messages[0].content !== "Hello World") {
        throw new Error("Message persistence failed");
    }
    console.log("[DB] Message verified.");

    // 2. XLSX Check
    console.log("[XLSX] Reading range A1:B2...");
    const range = getRange("A1:B2");
    console.log("[XLSX] Range read:", JSON.stringify(range.values));
    if (range.values.length === 0) throw new Error("Failed to read range");

    console.log("[XLSX] Updating cell E2...");
    const updateResult = updateCell("E2", "Updated Note");
    console.log("[XLSX] Cell updated:", updateResult.updated);

    console.log("[XLSX] Verifying update...");
    const verifyRange = getRange("E2");
    if (verifyRange.values[0][0] !== "Updated Note") {
        throw new Error("Update persistence failed");
    }
    console.log("[XLSX] Update verified.");

    console.log("System Check Completed Successfully.");
}

runCheck().catch((err) => {
    console.error("System Check Failed:", err);
    process.exit(1);
});
