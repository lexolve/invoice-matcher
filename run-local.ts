import { Effect } from "effect";

// Import and run the program directly from index.ts
async function runLocal() {
  try {
    console.log("Starting local execution...");
    console.log("Environment variables loaded:");
    console.log("- CONSUMER_TOKEN:", process.env.CONSUMER_TOKEN ? "✓" : "✗");
    console.log("- EMPLOYEE_TOKEN:", process.env.EMPLOYEE_TOKEN ? "✓" : "✗");
    console.log("- APPNAME:", process.env.APPNAME ? "✓" : "✗");
    console.log("- CHARGEBEE_API_KEY:", process.env.CHARGEBEE_API_KEY ? "✓" : "✗");
    console.log("\n");

    // Import the program function and slack notification
    const { program } = await import("./src/index");
    const { sendFormattedSlackNotification } = await import("./src/slack");
    
    // Run the program
    await Effect.runPromise(program());
    
    // Send success notification
    await sendFormattedSlackNotification(
      'Successfully ran tripletex matcher job', { status: 'success' }
    );
    
    console.log("\n✅ Successfully completed tripletex matcher job");
  } catch (error) {
    console.error("\n❌ Failed to run tripletex matcher job:", error);
    
    // Import slack notification if not already imported
    const { sendFormattedSlackNotification } = await import("./src/slack");
    
    // Send error notification
    await sendFormattedSlackNotification(
      'Failed to run tripletex matcher job', 
      { message: error instanceof Error ? error.message : 'Internal Server Error' }
    );
    
    process.exit(1);
  }
}

runLocal();