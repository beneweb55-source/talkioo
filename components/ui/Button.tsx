import React from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  isLoading?: boolean;
  children?: React.ReactNode;
  className?: string;
}

// Casting motion.button to any to bypass strict type checking issues with framer-motion props in this environment
const MotionButton = motion.button as any;

export const Button: React.FC<ButtonProps & HTMLMotionProps<"button">> = ({ 
  children, 
  variant = 'primary', 
  isLoading, 
  className = '', 
  disabled,
  ...props 
}) => {
  const baseStyles = "relative w-full py-2.5 px-4 rounded-xl font-semibold text-sm transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 overflow-hidden";
  
  const variants = {
    primary: "bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-white shadow-lg shadow-brand-500/30 focus:ring-brand-500 border border-transparent",
    secondary: "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 focus:ring-gray-400 shadow-sm",
    danger: "bg-red-500 hover:bg-red-600 text-white focus:ring-red-500 shadow-lg shadow-red-500/30",
    ghost: "bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400"
  };

  const isDisabled = isLoading || disabled;

  return (
    <MotionButton 
      whileHover={{ scale: isDisabled ? 1 : 1.02 }}
      whileTap={{ scale: isDisabled ? 1 : 0.98 }}
      className={`${baseStyles} ${variants[variant]} ${className}`}
      disabled={isDisabled}
      {...props}
    >
      {isLoading ? (
        <div className="flex items-center gap-2">
           <svg className="animate-spin h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Chargement...</span>
        </div>
      ) : children}
    </MotionButton>
  );
};