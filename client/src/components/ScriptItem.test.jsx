import { render, screen, fireEvent } from '@testing-library/react';
import ScriptItem from './ScriptItem';

const baseScript = { id: 's1', group: 'BACKEND SCRIPTS', name: 'deploy.sh', status: 'idle' };

const setup = (script = baseScript, handlers = {}) => {
  const onToggle = handlers.onToggle ?? vi.fn();
  const onExecute = handlers.onExecute ?? vi.fn();
  const onEdit = handlers.onEdit ?? vi.fn();
  const onRemove = handlers.onRemove ?? vi.fn();
  render(
    <ScriptItem
      script={script}
      selected={false}
      onToggle={onToggle}
      onExecute={onExecute}
      onEdit={onEdit}
      onRemove={onRemove}
    />,
  );
  return { onToggle, onExecute, onEdit, onRemove };
};

describe('ScriptItem', () => {
  it('renders script name and action buttons', () => {
    setup();
    expect(screen.getByText('deploy.sh')).toBeInTheDocument();
    expect(screen.getByText('Execute')).toBeInTheDocument();
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('shows the correct status badge text per state', () => {
    const { rerender } = render(
      <ScriptItem
        script={baseScript}
        selected={false}
        onToggle={vi.fn()}
        onExecute={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('Idle')).toBeInTheDocument();

    rerender(
      <ScriptItem
        script={{ ...baseScript, status: 'running' }}
        selected={false}
        onToggle={vi.fn()}
        onExecute={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('Running')).toBeInTheDocument();

    rerender(
      <ScriptItem
        script={{ ...baseScript, status: 'exited' }}
        selected={false}
        onToggle={vi.fn()}
        onExecute={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('Exited')).toBeInTheDocument();
  });

  it('fires handlers with the script on user actions', () => {
    const { onToggle, onExecute, onEdit, onRemove } = setup();
    fireEvent.click(screen.getByText('Execute'));
    expect(onExecute).toHaveBeenCalledWith(baseScript);

    fireEvent.click(screen.getByText('Edit'));
    expect(onEdit).toHaveBeenCalledWith(baseScript);

    fireEvent.click(screen.getByText('Delete'));
    expect(onRemove).toHaveBeenCalledWith(baseScript);

    fireEvent.click(screen.getByLabelText('Select deploy.sh'));
    expect(onToggle).toHaveBeenCalledWith('s1');
  });
});
