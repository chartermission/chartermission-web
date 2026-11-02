import type { ButtonHTMLAttributes } from "react";
import { cn } from "../cn";

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost";
export type ButtonSize = "default" | "small";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-primary text-inverse hover:bg-primary-light",
  accent: "bg-accent text-inverse hover:bg-accent-hover",
  secondary: "bg-card text-ink border border-line-strong hover:bg-muted",
  ghost: "text-primary hover:bg-primary-tint-2",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "px-[18px] py-[10px] text-md font-medium",
  small: "px-3 py-1.5 text-sm font-medium",
};

/**
 * Class names for the Figma Button (node 5:235). Use on <a> or a router Link
 * when a button-styled link is needed.
 */
export function buttonClasses({
  variant = "primary",
  size = "default",
  block = false,
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; className?: string } = {}) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-lg whitespace-nowrap transition-colors",
    "disabled:pointer-events-none disabled:opacity-50",
    variantClasses[variant],
    sizeClasses[size],
    block && "w-full",
    className,
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
};

export function Button({ variant, size, block, className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClasses({ variant, size, block, className })} {...rest} />;
}
