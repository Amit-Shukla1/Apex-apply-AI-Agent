// Shared mutable flag — lets server.js and application.agent.js communicate
// without circular imports. Server sets skipManualWait = true when user clicks
// "Done" in the UI. Agent polls it and clears it after consuming.
export const waitControl = { skip: false };
