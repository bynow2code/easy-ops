import { IconDownload, IconUpload, IconRefresh, IconExpand, IconSettings } from './Icons.jsx';

/**
 * 顶部按钮区
 *  - 左侧：Execute Selected / Add Script / Delete Selected（计数联动 selected.length）
 *  - 右侧：5 个线性图标（下载 / 上传 / 刷新 / 最大化 / 设置）
 */
export default function TopBar({
  selectedCount,
  onExecuteSelected,
  onAddScript,
  onDeleteSelected,
}) {
  const disableSel = selectedCount === 0;
  return (
    <header className="top-bar">
      <div className="top-bar__left">
        <button
          className={`pill pill--muted ${disableSel ? 'is-disabled' : ''}`}
          disabled={disableSel}
          onClick={onExecuteSelected}
        >
          Execute Selected ({selectedCount})
        </button>
        <button className="pill pill--white" onClick={onAddScript}>
          Add Script
        </button>
        <button
          className={`pill pill--muted ${disableSel ? 'is-disabled' : ''}`}
          disabled={disableSel}
          onClick={onDeleteSelected}
        >
          Delete Selected ({selectedCount})
        </button>
      </div>
      <div className="top-bar__right">
        <IconBtn title="Download"><IconDownload /></IconBtn>
        <IconBtn title="Upload"><IconUpload /></IconBtn>
        <IconBtn title="Refresh"><IconRefresh /></IconBtn>
        <IconBtn title="Fullscreen"><IconExpand /></IconBtn>
        <IconBtn title="Settings"><IconSettings /></IconBtn>
      </div>
    </header>
  );
}

function IconBtn({ title, children }) {
  return (
    <button className="icon-btn" title={title} aria-label={title}>
      {children}
    </button>
  );
}
