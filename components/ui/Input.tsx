import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({ label, error, className = '', ...props }) => {
  return (
    <div className="mb-4">
      {label && (
        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5 ml-1">
          {label}
        </label>
      )}
      <input
        className={`w-full px-4 py-3 border rounded-xl shadow-sm outline-none transition-all duration-200
        bg-gray-50 dark:bg-gray-800/50 text-gray-900 dark:text-white
        placeholder-gray-400 dark:placeholder-gray-500
        focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500
        ${error 
            ? 'border-red-500 dark:border-red-500 focus:ring-red-500/20' 
            : 'border-gray-200 dark:border-gray-700'
        } ${className}`}
        {...props}
      />
      {error && <p className="mt-1.5 ml-1 text-xs font-medium text-red-500 animate-pulse">{error}</p>}
    </div>
  );
};