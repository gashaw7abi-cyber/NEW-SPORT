import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCcw } from 'lucide-react';
import { Button } from './ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let errorMessage = 'ያልተጠበቀ ችግር አጋጥሟል። እባክዎ ገጹን ያድሱት።';
      
      try {
        const parsedError = JSON.parse(this.state.error?.message || '');
        if (parsedError.error && parsedError.error.includes('permissions')) {
          errorMessage = 'ይቅርታ፣ ይህንን ተግባር ለማከናወን ፈቃድ የለዎትም።';
        }
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center p-6 text-center">
          <div className="h-20 w-20 bg-red-500/10 rounded-full flex items-center justify-center mb-6">
            <AlertCircle className="h-10 w-10 text-red-500" />
          </div>
          <h1 className="text-xl font-bold text-white mb-2">ችግር አጋጥሟል</h1>
          <p className="text-sm text-white/60 mb-8 max-w-xs">
            {errorMessage}
          </p>
          <Button 
            onClick={() => window.location.reload()}
            className="bg-amber-500 hover:bg-amber-600 text-black font-bold rounded-full px-8"
          >
            <RefreshCcw className="h-4 w-4 mr-2" />
            እንደገና ይሞክሩ
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
