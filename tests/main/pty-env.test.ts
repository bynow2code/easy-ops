import { describe, expect, it } from 'vitest'
import { shellEnv } from '../../src/main/pty/env'

describe('shellEnv', () => {
  it('剥掉 npm 运行时注入的变量(dev 经 npm run 启动会带来 nvm 告警)', () => {
    const env = shellEnv({
      PATH: '/usr/bin:/bin',
      HOME: '/Users/arthur',
      npm_config_prefix: '/Users/arthur/.workbuddy/binaries/node/versions/22.22.2-3',
      npm_config_registry: 'https://registry.npmmirror.com',
      npm_lifecycle_event: 'dev',
      npm_package_name: 'easyops'
    })

    expect(env).toEqual({ PATH: '/usr/bin:/bin', HOME: '/Users/arthur' })
  })

  it('不误伤 NVM_DIR 等 npm_ 以外的变量', () => {
    const env = shellEnv({ NVM_DIR: '/Users/arthur/.nvm', NODE_OPTIONS: '--max-old-space-size=4096' })
    expect(env).toEqual({ NVM_DIR: '/Users/arthur/.nvm', NODE_OPTIONS: '--max-old-space-size=4096' })
  })
})
