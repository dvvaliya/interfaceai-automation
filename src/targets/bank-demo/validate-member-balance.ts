import type { ComputerSurface } from "../../surface/types.js";

export async function validateMemberBalanceCompletion(
  surface: ComputerSurface,
): Promise<string> {
  const checkpointVisible = await surface.isVisible(
    { strategy: "role", role: "heading", name: "Member Profile", exact: true },
    1_000,
  );
  if (!checkpointVisible) {
    throw new Error("Discovery reported completion before the Member Profile checkpoint was visible.");
  }

  return surface.extractTableCell(
    { strategy: "role", role: "region", name: "Deposit Accounts", exact: true },
    { column: "Type", value: "Regular Savings" },
    "Available Balance",
  );
}
