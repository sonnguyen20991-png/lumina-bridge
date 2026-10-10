import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`Uncaught error in ${this.props.name || 'Component'}:`, error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      
      const isDev = false;
      
      return (
        <div className="p-12 border-2 border-dashed border-rose-500/20 rounded-2xl bg-rose-500/5 text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-rose-500/10 flex items-center justify-center mx-auto text-rose-400">
            <span className="material-symbols-outlined text-3xl">error</span>
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-white">Module Error</h3>
            <p className="text-sm text-rose-300/60 max-w-md mx-auto">
              The {this.props.name || 'section'} encountered a runtime error and could not be rendered.
            </p>
          </div>
          <div className="pt-4">
            <button 
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-6 py-2 bg-rose-600 text-white text-xs font-bold uppercase tracking-widest rounded-lg hover:bg-rose-500 transition-all"
            >
              Attempt Recovery
            </button>
          </div>
          {isDev && this.state.error && (
            <div className="mt-8 p-4 bg-black/40 rounded text-left overflow-auto max-h-48">
              <pre className="text-[10px] text-rose-400 font-mono">
                {this.state.error.stack}
              </pre>
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
