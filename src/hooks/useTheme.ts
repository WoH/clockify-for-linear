import { useState, useEffect, useCallback } from "react";

export type LinearTheme = "light" | "dark" | "dark-contrast" | "linear-light";

export function useTheme() {
  const [theme, setTheme] = useState<LinearTheme>(() => {
    const stored = localStorage.getItem("linear-theme") as LinearTheme;
    return stored || "dark";
  });

  useEffect(() => {
    const root = document.documentElement;
    
    // Remove all theme classes
    root.classList.remove("light", "dark", "dark-contrast", "linear-light");
    
    // Add appropriate class
    if (theme === "light" || theme === "linear-light") {
      root.classList.remove("dark");
    } else {
      root.classList.add("dark");
    }
    
    // Set data attribute for fine-grained theme control
    root.setAttribute("data-theme", theme);
    
    localStorage.setItem("linear-theme", theme);
  }, [theme]);

  const changeTheme = useCallback((newTheme: LinearTheme) => {
    setTheme(newTheme);
  }, []);

  return { theme, changeTheme };
}
