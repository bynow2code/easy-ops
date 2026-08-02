// 后端连接基址解析：Electron 内走绝对 URL，纯 Vite dev 走相对路径。
// 与 shellApi / scriptsApi / SettingsModal 共用，避免三处重复端口重试逻辑。
const api = typeof window !== 'undefined' ? window.easyOps : null;

const MAX_PORT_RETRIES = 20;
const PORT_RETRY_DELAY = 150;

// Electron 内：后端端口由主进程从 port.txt 读出（api.backend.getPort），
// 带重试等待后端就绪；返回 http://127.0.0.1:<port>。
// 纯 Vite dev（无 Electron）：返回 ''，请求走相对路径 /api（由 vite 代理）。
export async function resolveBaseUrl() {
  if (!api?.backend?.getPort) return '';
  for (let i = 0; i < MAX_PORT_RETRIES; i++) {
    const port = await api.backend.getPort();
    if (port) return `http://127.0.0.1:${port}`;
    await new Promise((r) => setTimeout(r, PORT_RETRY_DELAY));
  }
  return '';
}
