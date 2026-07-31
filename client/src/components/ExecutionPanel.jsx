import ExecutionCard from './ExecutionCard.jsx';

/**
 * 右侧执行输出面板：
 *  - 顶部标题 + Close all
 *  - 空态文案（与截图一致，含拼写 "Excute"）
 *  - 每个执行一项独立的输出卡，超出面板高度出现自定义滚动条
 */
export default function ExecutionPanel({
  executions,
  onClose,
  onCloseAll,
  onRerun,
  onToggleStick,
}) {
  return (
    <section className="panel panel--exec">
      <div className="exec-head">
        <div className="exec-head__title">Execution Outputs</div>
        <button className="pill pill--white" onClick={onCloseAll}>Close all</button>
      </div>

      <div className="exec-list">
        {executions.length === 0 ? (
          <div className="exec-empty">
            <div>No execution output yet.</div>
            <div>Excute a script to see output here.</div>
          </div>
        ) : (
          executions.map((e) => (
            <ExecutionCard
              key={e.id}
              exec={e}
              onClose={onClose}
              onRerun={onRerun}
              onToggleStick={onToggleStick}
            />
          ))
        )}
      </div>
    </section>
  );
}
