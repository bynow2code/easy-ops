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
  // 主题图标/提示按三态查表，避免层层三元
  const THEME_ICONS = { dark: IconMoon, light: IconSun, system: IconContrast };
  const THEME_TITLES = {
    dark: 'Theme: Dark — click to switch to Light',
    light: 'Theme: Light — click to switch to Follow system',
    system: 'Theme: Follow system — click to switch to Dark',
  };
  const ThemeIcon = THEME_ICONS[theme] || IconContrast;
  const themeTitle = THEME_TITLES[theme] || THEME_TITLES.system;
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
