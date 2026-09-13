import { Button, Typography } from 'antd'

export default function App(): JSX.Element {
  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={4}>EasyOps</Typography.Title>
      <Button type="primary" onClick={() => console.log(window.api.ping())}>
        测试 IPC
      </Button>
    </div>
  )
}
