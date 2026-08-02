#!/bin/sh
# hello.sh — 跨平台示例脚本
#
# 这个脚本刻意只用 POSIX sh 标准语法，因此可以在以下环境直接运行：
#   - macOS   : 系统默认 shell（/bin/zsh 或 /bin/bash）
#   - Linux   : 系统默认 shell（bash / zsh / dash ...）
#   - Windows : Git Bash（C:\Program Files\Git\bin\bash.exe）或 WSL
#
# 在 easy-ops 里：把脚本的"解释器"设为 Global（会用当前系统默认 POSIX 壳），
# 或显式选 zsh / bash / Git Bash / wsl，都能跑这份 .sh。
#
# 写法红线（避免 bash 专属，保证可移植）：
#   ✅ 用 变量 / if..fi / for..do..done / case..esac / $(...) / && ||
#   ❌ 不用 [[ ]]、数组、source、function f(){}、<( ) 进程替换
# 需要 bash 特性时，把首行改成 #!/usr/bin/env bash

set -eu

greet() {
  # $1 是第一个参数，缺省时用默认值
  name="${1:-world}"
  echo "Hello, $name!"
}

echo "Running on: $(uname -s)  (shell: $0)"
echo "Current time: $(date '+%Y-%m-%d %H:%M:%S')"

for who in "$@"; do
  greet "$who"
done

# 没给参数时打一个默认问候
if [ "$#" -eq 0 ]; then
  greet
fi

echo "Done."
