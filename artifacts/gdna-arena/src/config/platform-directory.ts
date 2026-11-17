// Placeholder: original module is missing from the repository. Replace with the real implementation.
import type { ComponentType } from "react";
import { stub, type StubFn } from "../lib/_stub";

export interface PlatformSection {
  id: string;
  route: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  names: Record<string, string>;
}
export const DIRECTORY: PlatformSection[] = [];
export const PUBLIC_ORIGIN: any = stub("PUBLIC_ORIGIN");
export const SEARCH_ROUTE: any = stub("SEARCH_ROUTE");
export const SETTINGS_ROUTE: any = stub("SETTINGS_ROUTE");
export const UI_TEXT: any = stub("UI_TEXT");
export const findPlatformSections = (_query: string, _origin?: string): PlatformSection[] => [];
