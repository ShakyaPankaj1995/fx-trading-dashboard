import React, { createContext, useContext } from 'react';
import { useSignalLog } from '../hooks/useSignalLog';

const SignalLogContext = createContext(null);

export const SignalLogProvider = ({ children }) => {
  const logState = useSignalLog();
  return (
    <SignalLogContext.Provider value={logState}>
      {children}
    </SignalLogContext.Provider>
  );
};

export const useSignalLogContext = () => {
  const ctx = useContext(SignalLogContext);
  if (!ctx) throw new Error('useSignalLogContext must be used within SignalLogProvider');
  return ctx;
};
