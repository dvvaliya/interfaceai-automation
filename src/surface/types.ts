export type SurfaceObservation = {
  url: string;
  title: string;
  accessibilitySnapshot: string;
  screenshotPath: string;
  observedAt: string;
};

export type HumanActionEvent = {
  sequence: number;
  type: "click" | "change" | "navigation" | "state_change";
  capture: "exact" | "inferred";
  role: string;
  name: string;
  from?: string;
  to?: string;
  description?: string;
  timestamp: string;
};

export type CapturedHumanAction = Omit<HumanActionEvent, "sequence">;

export type RoleTarget = {
  strategy: "role";
  role:
    | "button"
    | "cell"
    | "combobox"
    | "heading"
    | "link"
    | "region"
    | "row"
    | "textbox";
  name: string;
  exact?: boolean;
};

export type LabelTarget = {
  strategy: "label";
  label: string;
  exact?: boolean;
};

export type TextTarget = {
  strategy: "text";
  text: string;
  exact?: boolean;
};

export type SurfaceTarget = RoleTarget | LabelTarget | TextTarget;

export interface ComputerSurface {
  observe(evidenceName: string): Promise<SurfaceObservation>;
  fill(target: SurfaceTarget, value: string): Promise<void>;
  click(target: SurfaceTarget): Promise<void>;
  isVisible(target: SurfaceTarget, timeoutMs?: number): Promise<boolean>;
  extractText(target: SurfaceTarget): Promise<string>;
  extractTableCell(
    tableTarget: SurfaceTarget,
    rowMatch: { column: string; value: string },
    outputColumn: string,
  ): Promise<string>;
  beginHumanControl(): Promise<void>;
  endHumanControl(): Promise<CapturedHumanAction[]>;
}
