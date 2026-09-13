import { Button, Typography } from 'antd'

export default function App(): JSX.Element {
  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={4}>EasyOps</Typography.Title>
      <Button type="primary" onClick={() => void window.api.app.info().then((info) => console.log(info))}>
        测试 IPC
      </Button>
    </div>
  )
}
