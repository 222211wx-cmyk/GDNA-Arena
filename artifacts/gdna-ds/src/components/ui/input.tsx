import { createElement, type ComponentProps, type ReactNode } from "react";

type Extra = {
  onValueChange?: (value: string) => void;
  onCheckedChange?: (checked: boolean) => void;
  onOpenChange?: (open: boolean) => void;
  asChild?: boolean;
  variant?: string;
  size?: string;
};
type Tag = "div" | "button" | "input" | "label" | "textarea" | "table" | "tbody" | "td" | "th" | "thead" | "tr" | "select" | "option" | "h2" | "h3";
type P<T extends Tag> = Omit<ComponentProps<T>, keyof Extra | "children"> & Extra & { children?: ReactNode } & Record<string, unknown>;
const make = <T extends Tag>(tag: T) => (props: P<T>) => {
  const { asChild: _a, variant: _v, size: _s, onValueChange: _ov, onCheckedChange: _oc, onOpenChange: _oo, ...rest } = props as Extra & Record<string, unknown>;
  return createElement(tag, rest);
};

export const Input = make("input");
