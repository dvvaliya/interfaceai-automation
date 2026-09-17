import type { CapabilityArtifact } from "../../artifacts/schema.js";
import type { ComputerSurface } from "../../surface/types.js";

type OutputDefinition = CapabilityArtifact["outputs"][string];

export type MemberOutputSpec = {
  outputName: string;
  idSegment: string;
  displayName: string;
  definition: OutputDefinition;
  extract(surface: ComputerSurface): Promise<string>;
};

const memberIdentityContainer = locatorPlan("region", "Member Identity");
const depositAccountsContainer = locatorPlan("region", "Deposit Accounts");

const specs: MemberOutputSpec[] = [
  labeledSpec("memberName", "name", "name", "Member Name"),
  labeledSpec("memberStatus", "status", "member status", "Status"),
  labeledSpec("homeBranch", "home_branch", "home branch", "Home Branch"),
  labeledSpec("email", "email", "email address", "Email"),
  labeledSpec("telephone", "telephone", "telephone number", "Telephone"),
  tableSpec(
    "savingsBalance",
    "savings_balance",
    "Regular Savings available balance",
    "Regular Savings",
    "Available Balance",
  ),
  tableSpec(
    "checkingBalance",
    "checking_balance",
    "Everyday Checking available balance",
    "Everyday Checking",
    "Available Balance",
  ),
  tableSpec(
    "savingsAccount",
    "savings_account",
    "Regular Savings account reference",
    "Regular Savings",
    "Account",
  ),
  tableSpec(
    "checkingAccount",
    "checking_account",
    "Everyday Checking account reference",
    "Everyday Checking",
    "Account",
  ),
];

export function resolveMemberOutputSpecs(
  goal: string,
  modelOutputs: Readonly<Record<string, string>>,
): MemberOutputSpec[] {
  const modelSelected = new Set<string>();
  const goalSelected = new Set<string>();
  const normalizedGoal = normalize(goal);

  for (const key of Object.keys(modelOutputs)) {
    const spec = findSpec(key);
    if (spec) modelSelected.add(spec.outputName);
  }

  if (/name|accountholder|holdername/.test(normalizedGoal)) goalSelected.add("memberName");
  if (/status/.test(normalizedGoal)) goalSelected.add("memberStatus");
  if (/branch/.test(normalizedGoal)) goalSelected.add("homeBranch");
  if (/email/.test(normalizedGoal)) goalSelected.add("email");
  if (/phone|telephone/.test(normalizedGoal)) goalSelected.add("telephone");
  if (/savingsbalance|savingbalance/.test(normalizedGoal)) goalSelected.add("savingsBalance");
  if (/checkingbalance|currentbalance/.test(normalizedGoal)) goalSelected.add("checkingBalance");
  if (/savingsaccount/.test(normalizedGoal) && !/balance/.test(normalizedGoal)) {
    goalSelected.add("savingsAccount");
  }
  if (/checkingaccount/.test(normalizedGoal) && !/balance/.test(normalizedGoal)) {
    goalSelected.add("checkingAccount");
  }

  const selected = goalSelected.size > 0 ? goalSelected : modelSelected;
  const resolved = specs.filter((spec) => selected.has(spec.outputName));
  if (resolved.length === 0) {
    throw new Error(
      "The completed goal did not declare a supported member-profile output for deterministic replay.",
    );
  }
  return resolved;
}

export async function extractMemberOutputs(
  surface: ComputerSurface,
  outputSpecs: readonly MemberOutputSpec[],
): Promise<Record<string, string>> {
  const outputs: Record<string, string> = {};
  for (const spec of outputSpecs) outputs[spec.outputName] = await spec.extract(surface);
  return outputs;
}

function findSpec(rawName: string): MemberOutputSpec | undefined {
  const name = normalize(rawName);
  if (name === "membernumber" || name === "memberid") return undefined;
  return specs.find(
    (spec) =>
      normalize(spec.outputName) === name ||
      normalize(spec.idSegment) === name ||
      normalize(spec.displayName) === name ||
      (name.includes("name") && spec.outputName === "memberName") ||
      (name.includes("savings") && name.includes("balance") && spec.outputName === "savingsBalance") ||
      (name.includes("checking") && name.includes("balance") && spec.outputName === "checkingBalance"),
  );
}

function labeledSpec(
  outputName: string,
  idSegment: string,
  displayName: string,
  label: string,
): MemberOutputSpec {
  return {
    outputName,
    idSegment,
    displayName,
    definition: {
      type: "string",
      description: `The member's ${displayName}.`,
      required: true,
      source: { kind: "labeled_value", container: memberIdentityContainer, label },
    },
    extract: (surface) =>
      surface.extractLabeledValue(
        { strategy: "role", role: "region", name: "Member Identity", exact: true },
        label,
      ),
  };
}

function tableSpec(
  outputName: string,
  idSegment: string,
  displayName: string,
  accountType: string,
  column: string,
): MemberOutputSpec {
  return {
    outputName,
    idSegment,
    displayName,
    definition: {
      type: "string",
      description: `The member's ${displayName}.`,
      required: true,
      source: {
        kind: "table_cell",
        table: depositAccountsContainer,
        rowMatch: { column: "Type", value: accountType },
        column,
      },
    },
    extract: (surface) =>
      surface.extractTableCell(
        { strategy: "role", role: "region", name: "Deposit Accounts", exact: true },
        { column: "Type", value: accountType },
        column,
      ),
  };
}

function locatorPlan(role: "region", name: string) {
  return {
    primary: { strategy: "role" as const, role, name, exact: true },
    fallbacks: [],
    rationale: `The '${name}' region is stable and independent of member data.`,
  };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
