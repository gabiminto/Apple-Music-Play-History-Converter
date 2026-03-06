import { ReactNode, ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "primary" | "secondary" | "ghost" | "destructive" | "outline";
    size?: "sm" | "md" | "lg";
    loading?: boolean;
    children: ReactNode;
    icon?: ReactNode;
}

export function Button({
    variant = "primary",
    size = "md",
    loading = false,
    className = "",
    children,
    icon,
    disabled,
    ...props
}: ButtonProps) {
    const baseStyles = "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-medium active:scale-98";

    const variants = {
        primary: "bg-accent text-white hover:bg-accent/90 shadow-minimal hover:shadow-lg focus:ring-accent/50 shine-hover",
        secondary: "bg-foreground-10 text-foreground hover:bg-foreground-15 shadow-minimal focus:ring-foreground-30",
        ghost: "bg-transparent hover:bg-foreground-5 text-foreground focus:ring-foreground-20 hover:shadow-minimal",
        destructive: "bg-destructive/10 text-destructive hover:bg-destructive/20 shadow-minimal focus:ring-destructive/30 border border-destructive/20",
        outline: "border-2 border-border bg-transparent hover:bg-foreground-5 hover:border-foreground-30 focus:ring-foreground-20 shadow-minimal",
    };

    const sizes = {
        sm: "px-3 py-1.5 text-xs",
        md: "px-5 py-2.5 text-sm",
        lg: "px-7 py-3.5 text-base",
    };

    return (
        <button
            className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
            disabled={disabled || loading}
            {...props}
        >
            {loading && (
                <span className="spinner" style={{ width: '1em', height: '1em' }}>
                    {Array.from({ length: 9 }).map((_, i) => (
                        <span key={i} className="spinner-cube" />
                    ))}
                </span>
            )}
            {!loading && icon}
            {children}
        </button>
    );
}
