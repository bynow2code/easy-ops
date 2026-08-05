import struct, os

PUB = r'D:\www\EasyOps\client\public'

def png_size(path):
    with open(path, 'rb') as f:
        sig = f.read(8)
        if sig != b'\x89PNG\r\n\x1a\n':
            return 'not-png'
        f.read(4)  # length
        t = f.read(4)
        if t != b'IHDR':
            return 'no-IHDR'
        w, h = struct.unpack('>II', f.read(8))
        return (w, h)

def ico_sizes(path):
    with open(path, 'rb') as f:
        data = f.read()
    if len(data) < 6 or data[2:4] != b'\x01\x00':
        return 'not-ico'
    count = struct.unpack('<H', data[4:6])[0]
    out = []
    off = 6
    for _ in range(count):
        w = data[off]; h = data[off + 1]
        bw = 256 if w == 0 else w
        bh = 256 if h == 0 else h
        out.append((bw, bh))
        off += 16
    return out

for name in ['logo-1024.png', 'logo.png', 'logo-mac.png', 'logo-win.png', 'logo.ico']:
    p = os.path.join(PUB, name)
    if not os.path.exists(p):
        print(f'{name:18} MISSING')
        continue
    sz = ico_sizes(p) if name.endswith('.ico') else png_size(p)
    print(f'{name:18} {sz}')
