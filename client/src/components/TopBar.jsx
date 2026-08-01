import {
  IconDownload,
  IconUpload,
  IconSettings,
  IconSun,
  IconMoon,
  IconContrast,
} from './Icons.jsx';

/**
 * 顶部按钮区
 *  - 左侧：Execute Selected / Add Script / Delete Selected（计数联动 selected.length）
 *  - 右侧：4 个线性图标（下载 / 上传 / 主题切换 / 设置）
 */
export default function TopBar({
  selectedCount,
  onExecuteSelected,
  onAddScript,
  onAddGroup,
  onDeleteSelected,
  theme,
  onCycleTheme,
  onOpenSettings,
}) {
  const disableSel = selectedCount === 0;
  const ThemeIcon = theme === 'dark' ? IconMoon : theme === 'light' ? IconSun : IconContrast;
  const themeTitle =
    theme === 'dark'
      ? 'Theme: Dark — click to switch to Light'
      : theme === 'light'
        ? 'Theme: Light — click to switch to Follow system'
        : 'Theme: Follow system — click to switch to Dark';
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
        <button className="pill pill--white" onClick={onAddGroup}>
          Add Group
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
        <IconBtn title="Download">
          <IconDownload />
        </IconBtn>
        <IconBtn title="Upload">
          <IconUpload />
        </IconBtn>
        <IconBtn title={themeTitle} onClick={onCycleTheme}>
          <ThemeIcon />
        </IconBtn>
        <IconBtn title="Settings" onClick={onOpenSettings}>
          <IconSettings />
        </IconBtn>
      </div>
    </header>
  );
}

function IconBtn({ title, onClick, children }) {
  return (
    <button className="icon-btn" title={title} aria-label={title} onClick={onClick}>
      {children}
    </button>
  );
}
