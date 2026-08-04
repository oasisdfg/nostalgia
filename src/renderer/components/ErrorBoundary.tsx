import { Component, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { EmptyState } from './EmptyState';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error('[renderer] uncaught error', error);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="grid h-screen place-items-center bg-bg text-fg">
          <EmptyState
            icon={<TriangleAlert className="h-6 w-6" />}
            title="Something went wrong"
            hint={this.state.error.message}
            action={
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
              >
                Reload
              </button>
            }
          />
        </div>
      );
    }
    return this.props.children;
  }
}
