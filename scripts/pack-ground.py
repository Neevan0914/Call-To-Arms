#!/usr/bin/env python3
"""Pack the ground texture sets for the terrain shader (2 textures per set, so all six
sets fit in the GPU's texture units):

    <set>_ca.webp   RGB = albedo (sRGB),        A = ambient occlusion
    <set>_nrh.webp  RG  = normal XY (OpenGL),   B = roughness,  A = height

The normal's Z is rebuilt in the shader.
    python3 scripts/pack-ground.py <folder with <set>_albedo.jpg ...> public/assets/textures
"""
import sys, os
import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
for s in ['grass', 'dirt', 'forest_floor', 'gravel', 'rock', 'moss']:
    alb = np.asarray(Image.open(f'{src}/{s}_albedo.jpg').convert('RGB'))
    ao = np.asarray(Image.open(f'{src}/{s}_ao.jpg').convert('L'))
    nrm = np.asarray(Image.open(f'{src}/{s}_normal.jpg').convert('RGB'))
    rough = np.asarray(Image.open(f'{src}/{s}_roughness.jpg').convert('L'))
    h16 = np.asarray(Image.open(f'{src}/{s}_height.png')).astype(np.float32)
    lo, hi = np.percentile(h16, 0.5), np.percentile(h16, 99.5)
    h8 = np.clip((h16 - lo) / max(1.0, hi - lo) * 255, 0, 255).astype(np.uint8)
    ca = np.dstack([alb, ao])
    nrh = np.dstack([nrm[..., 0], nrm[..., 1], rough, h8])
    Image.fromarray(ca, 'RGBA').save(f'{out}/{s}_ca.webp', quality=90, method=6)
    Image.fromarray(nrh, 'RGBA').save(f'{out}/{s}_nrh.webp', quality=92, method=6)
    print(s, os.path.getsize(f'{out}/{s}_ca.webp') // 1024, 'KB +', os.path.getsize(f'{out}/{s}_nrh.webp') // 1024, 'KB')
