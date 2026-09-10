export type SurfaceObservation = {
  url: string;
  title: string;
  accessibilitySnapshot: string;
  screenshotPath: string;
  observedAt: string;
};

export type RoleTarget = {
  strategy: "role";
  role: "button" | "link" | "textbox";
  name: string;
};

export type SurfaceTarget = RoleTarget;

export interface ComputerSurface {
  observe(evidenceName: string): Promise<SurfaceObservation>;
  fill(target: SurfaceTarget, value: string): Promise<void>;
  click(target: SurfaceTarget): Promise<void>;
}
