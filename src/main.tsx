import React, { StrictMode, Component, ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

window.addEventListener('unhandledrejection', (event) => {
  if (event.reason && event.reason.name === 'AbortError') {
    event.preventDefault();
  }
  if (event.reason && typeof event.reason.message === 'string' && event.reason.message.includes('aborted a request')) {
    event.preventDefault();
  }
});

window.addEventListener('error', (event) => {
  if (event.error && event.error.name === 'AbortError') {
    event.preventDefault();
  }
  if (event.error && typeof event.error.message === 'string' && event.error.message.includes('aborted a request')) {
    event.preventDefault();
  }
  if (event.message && typeof event.message === 'string' && event.message.includes('aborted a request')) {
    event.preventDefault();
  }
});

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (error.name === 'AbortError' || error.message.includes('aborted a request')) {
      console.warn("Ignored AbortError in ErrorBoundary.");
      // Soft recover
      this.setState({ hasError: false, error: null });
      return;
    }
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.state.error?.name === 'AbortError' || this.state.error?.message?.includes('aborted a request')) {
        return this.props.children;
      }
      
      return (
        <div style={{ padding: '20px', color: 'white', backgroundColor: 'black', fontFamily: 'monospace', height: '100vh', overflow: 'auto' }}>
          <h2>Something went wrong.</h2>
          <pre style={{ color: '#ff5555', whiteSpace: 'pre-wrap' }}>
            {this.state.error?.toString()}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}

const originalConsoleError = console.error;
console.error = (...args) => {
  const msg = args.map(a => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.message;
    try { return JSON.stringify(a); } catch(e) { return String(a); }
  }).join(' ');
  
  if (
    msg.includes('aborted a request') || 
    msg.includes('AbortError') || 
    msg.includes('Failed to fetch') ||
    msg.includes('Could not reach Cloud Firestore backend')
  ) {
    return;
  }
  originalConsoleError.apply(console, args);
};

const originalConsoleWarn = console.warn;
console.warn = (...args) => {
  const msg = args.map(a => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.message;
    try { return JSON.stringify(a); } catch(e) { return String(a); }
  }).join(' ');
  
  if (
    msg.includes('aborted a request') || 
    msg.includes('AbortError') || 
    msg.includes('Failed to fetch') ||
    msg.includes('Could not reach Cloud Firestore backend')
  ) {
    return;
  }
  originalConsoleWarn.apply(console, args);
};

window.addEventListener('unhandledrejection', (event) => {
  const msg = event.reason?.message || String(event.reason);
  if (msg.includes('aborted a request') || msg.includes('AbortError') || msg.includes('Failed to fetch')) {
    event.preventDefault();
  }
});

window.addEventListener('error', (event) => {
  const msg = event.message || '';
  if (msg.includes('aborted a request') || msg.includes('AbortError') || msg.includes('Failed to fetch')) {
    event.preventDefault();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
