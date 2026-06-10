const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function convertSvgToIco() {
  const svgPath = path.join(__dirname, 'frontend', 'public', 'logo.svg');
  const pngPath = path.join(__dirname, 'frontend', 'public', 'logo-256.png');
  const icoPath = path.join(__dirname, 'frontend', 'public', 'logo.ico');
  
  // 生成 256x256 PNG
  await sharp(svgPath)
    .resize(256, 256)
    .png()
    .toFile(pngPath);
  
  console.log('PNG created, converting to ICO...');
  
  // 使用 sharp 生成 ICO (sharp 从 0.32 开始支持直接输出 ico)
  // 先创建一个简化版本
  const { execSync } = require('child_process');
  
  // 使用 PowerShell 创建一个简单的 ICO 文件头
  const pngBuffer = fs.readFileSync(pngPath);
  
  // ICO 文件格式：文件头 + 目录项 + PNG 数据
  const iconDir = Buffer.alloc(6 + 16); // 6 字节头部 + 1 个目录项
  iconDir.writeUInt16LE(0, 0);     // Reserved
  iconDir.writeUInt16LE(1, 2);     // Image type: 1 = ICO
  iconDir.writeUInt16LE(1, 4);     // Number of images
  
  iconDir.writeUInt8(0, 6);        // Width (0 = 256)
  iconDir.writeUInt8(0, 7);        // Height (0 = 256)
  iconDir.writeUInt8(0, 8);        // Color palette
  iconDir.writeUInt8(0, 9);        // Reserved
  iconDir.writeUInt16LE(1, 10);     // Color planes
  iconDir.writeUInt16LE(32, 12);   // Bits per pixel
  iconDir.writeUInt32LE(pngBuffer.length, 14); // Image size
  iconDir.writeUInt32LE(22, 18);   // Offset to image data (6 + 16 = 22)
  
  const icoBuffer = Buffer.concat([iconDir, pngBuffer]);
  fs.writeFileSync(icoPath, icoBuffer);
  
  console.log('ICO created:', icoPath);
  
  // 清理临时文件
  fs.unlinkSync(pngPath);
}

convertSvgToIco().catch(console.error);
