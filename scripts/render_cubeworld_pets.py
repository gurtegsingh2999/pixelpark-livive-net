#!/usr/bin/env python3
"""
scripts/render_cubeworld_pets.py

Pure-Python 3D software rasterizer for Cube World animal companions.
Renders Wavefront OBJ models from assets/cubeworld-src/ into an isometric
sprite sheet in data/cubeworld_pets.json.

Key Features & Pipeline:
  1. Unified 3D World Scaling:
     Uses the Horse model (the largest animal, max dimension 3.37m) as the
     reference baseline. All animals are rendered with the exact same
     pixels-per-3D-unit world scale so their natural relative heights,
     lengths, and body volumes are faithfully preserved (e.g. chick < dog < horse).
  2. Ground Anchoring:
     All models are vertically anchored at their lowest foot/hoof contact point
     (min_y) so their feet rest at the exact same ground level in-game.
  3. Proper Winding Order & Culling:
     Handles screen-space inversion (where screen Y points downward) to ensure
     exterior front-facing voxel surfaces are rendered with positive barycentric
     weights and internal/back faces are cleanly culled.
  4. Outdoor Park Lighting Model:
     Direct key sunlight from high-front-right (+X, +Y, +Z), sky bounce fill,
     and an elevated ambient floor with top-plane specular highlights to match
     DiceBear Voxel Art's crisp aesthetic and avoid muddy shadows.
  5. Directional Orientation:
     Rendered facing Stage Left (azimuth +45°, elevation 35.264° isometric)
     consistent with Voxel Art left-default facing.
"""

import math
import struct
import zlib
import json
import os
import sys
import base64

def decode_png(filepath):
    """Decode an uncompressed or compressed RGBA PNG file into (width, height, bytearray)."""
    with open(filepath, 'rb') as f:
        data = f.read()
    pos = 8
    idat = bytearray()
    width, height = 0, 0
    while pos < len(data):
        length = struct.unpack('>I', data[pos:pos+4])[0]
        chunk_type = data[pos+4:pos+8]
        if chunk_type == b'IHDR':
            width, height, bit_depth, color_type = struct.unpack('>IIBB', data[pos+8:pos+18])
        elif chunk_type == b'IDAT':
            idat.extend(data[pos+8:pos+8+length])
        elif chunk_type == b'IEND':
            break
        pos += 12 + length
    
    raw = zlib.decompress(idat)
    bpp = 4
    stride = width * bpp + 1
    pixels = bytearray(width * height * bpp)
    
    for y in range(height):
        filter_type = raw[y * stride]
        line = bytearray(raw[y * stride + 1 : (y + 1) * stride])
        prev_line = pixels[(y - 1) * width * bpp : y * width * bpp] if y > 0 else bytearray(width * bpp)
        if filter_type == 1:
            for x in range(bpp, len(line)):
                line[x] = (line[x] + line[x - bpp]) & 0xFF
        elif filter_type == 2:
            for x in range(len(line)):
                line[x] = (line[x] + prev_line[x]) & 0xFF
        elif filter_type == 3:
            for x in range(len(line)):
                a = line[x - bpp] if x >= bpp else 0
                b = prev_line[x]
                line[x] = (line[x] + ((a + b) >> 1)) & 0xFF
        elif filter_type == 4:
            for x in range(len(line)):
                a = line[x - bpp] if x >= bpp else 0
                b = prev_line[x]
                c = prev_line[x - bpp] if x >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 0xFF
        pixels[y * width * bpp : (y + 1) * width * bpp] = line
    return width, height, pixels

def encode_png_data_url(width, height, rgba_data):
    """Encode an RGBA framebuffer directly to a PNG Data URL without external libraries."""
    raw = bytearray()
    bpp = 4
    for y in range(height):
        raw.append(0)
        raw.extend(rgba_data[y * width * bpp : (y + 1) * width * bpp])
    compressed = zlib.compress(raw, level=6)
    
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
    
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    png_bytes = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', compressed) + chunk(b'IEND', b'')
    return "data:image/png;base64," + base64.b64encode(png_bytes).decode('ascii')

def parse_obj(obj_path):
    """Parse Wavefront OBJ file vertices (v), texture coords (vt), normals (vn), and faces (f)."""
    v, vt, vn, faces = [], [], [], []
    with open(obj_path) as f:
        for line in f:
            if line.startswith('v '):
                v.append([float(x) for x in line.split()[1:4]])
            elif line.startswith('vt '):
                vt.append([float(x) for x in line.split()[1:3]])
            elif line.startswith('vn '):
                vn.append([float(x) for x in line.split()[1:4]])
            elif line.startswith('f '):
                parts = line.split()[1:]
                poly = []
                for p in parts:
                    idx = p.split('/')
                    poly.append((
                        int(idx[0]) - 1,
                        int(idx[1]) - 1 if len(idx) > 1 and idx[1] else 0,
                        int(idx[2]) - 1 if len(idx) > 2 and idx[2] else 0
                    ))
                faces.append(poly)
    return v, vt, vn, faces

def render_mesh(v, vt, vn, faces, atlas_w, atlas_h, atlas_px,
                img_size=128, world_scale=32.0,
                yaw_deg=45, pitch_deg=35.264,
                y_offset=0, leg_swing=0, head_pitch=0):
    """
    Renders a 3D mesh using software isometric rasterization.
    
    Arguments:
      world_scale: Pixels per 3D unit. Unified across all species so relative sizes are realistic.
      yaw_deg: Azimuth angle (+45° = Stage Left default).
      pitch_deg: Elevation angle (35.264° = True Isometric).
      leg_swing: Procedural trot animation angle offset for leg vertices.
      head_pitch: Procedural head pitch offset for idle/eating animations.
    """
    min_x = min(pt[0] for pt in v)
    max_x = max(pt[0] for pt in v)
    min_y = min(pt[1] for pt in v)
    max_y = max(pt[1] for pt in v)
    min_z = min(pt[2] for pt in v)
    max_z = max(pt[2] for pt in v)
    
    # Center horizontally and depth-wise, anchor vertically at feet (min_y)
    cx = (min_x + max_x) / 2
    cy = min_y
    cz = (min_z + max_z) / 2
    
    scale = world_scale
    
    cos_az = math.cos(math.radians(yaw_deg))
    sin_az = math.sin(math.radians(yaw_deg))
    cos_el = math.cos(math.radians(pitch_deg))
    sin_el = math.sin(math.radians(pitch_deg))
    
    transformed_v = []
    for pt in v:
        px_orig = (pt[0] - cx) * scale
        py_orig = (pt[1] - cy) * scale
        pz_orig = (pt[2] - cz) * scale
        
        # Procedural leg trot swing (bottom 40% of body)
        if pt[1] < min_y + (max_y - min_y) * 0.40 and leg_swing != 0:
            is_right_side = pt[0] > cx
            swing = leg_swing if is_right_side else -leg_swing
            pz_orig += swing * scale * 0.35
            
        # Head pitch for eating/pecking/sniffing
        if pt[1] > min_y + (max_y - min_y) * 0.55 and pt[2] > cz and head_pitch != 0:
            py_orig += head_pitch * scale * 0.25
            
        py_orig += y_offset * scale
        
        # Isometric projection (Azimuth yaw + Elevation pitch)
        rx = px_orig * cos_az - pz_orig * sin_az
        rz = px_orig * sin_az + pz_orig * cos_az
        px = rx + img_size / 2
        # Ground anchor placed 12px from bottom margin of 128x128 canvas
        py = img_size - 12 - (py_orig * cos_el - rz * sin_el)
        depth = py_orig * sin_el + rz * cos_el
        transformed_v.append((px, py, depth, [px_orig, py_orig, pz_orig]))
        
    zbuffer = [-1e9] * (img_size * img_size)
    framebuffer = bytearray(img_size * img_size * 4)
    
    # BRIGHT OUTDOOR SUNLIGHT MODEL:
    # Key light: bright direct sun coming from high-front-right (+X, +Y, +Z)
    # Fill light: soft sky bounce from high-back-left (-X, +Y, -Z)
    # Ambient: high baseline floor so pinks, whites, and colors stay vibrant and light
    sun_dir = [0.45, 0.85, 0.35]
    s_len = math.sqrt(sum(x*x for x in sun_dir))
    sun_dir = [x/s_len for x in sun_dir]
    
    sky_dir = [-0.35, 0.65, -0.35]
    sk_len = math.sqrt(sum(x*x for x in sky_dir))
    sky_dir = [x/sk_len for x in sky_dir]
    
    for poly in faces:
        for i in range(1, len(poly) - 1):
            # Polygon vertices in OBJ are counter-clockwise when viewed from front.
            # In screen coordinates (where Y points DOWN), counter-clockwise vertices
            # yield det < 0. To ensure front-facing polygons are rendered and back faces
            # are culled, swap p1 and p2 so front faces produce positive det > 0.
            p0_idx, p1_idx, p2_idx = poly[0], poly[i+1], poly[i]
            p0, p1, p2 = transformed_v[p0_idx[0]], transformed_v[p1_idx[0]], transformed_v[p2_idx[0]]
            
            # Screen-space determinant (cross product) for back-face culling
            det = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0])
            if det <= 0:
                continue
                
            uv = vt[p0_idx[1]]
            tx = int(uv[0] * atlas_w) % atlas_w
            ty = int((1.0 - uv[1]) * atlas_h) % atlas_h
            idx = (ty * atlas_w + tx) * 4
            cr, cg, cb, ca = atlas_px[idx:idx+4]
            if ca == 0:
                continue
                
            # Compute actual 3D face normal from geometry (in world space)
            v0_3d = p0[3]
            v1_3d = p1[3]
            v2_3d = p2[3]
            
            e1 = [v1_3d[0] - v0_3d[0], v1_3d[1] - v0_3d[1], v1_3d[2] - v0_3d[2]]
            e2 = [v2_3d[0] - v0_3d[0], v2_3d[1] - v0_3d[1], v2_3d[2] - v0_3d[2]]
            
            # Rotate edge vectors by yaw azimuth
            e1_w = [e1[0] * cos_az - e1[2] * sin_az, e1[1], e1[0] * sin_az + e1[2] * cos_az]
            e2_w = [e2[0] * cos_az - e2[2] * sin_az, e2[1], e2[0] * sin_az + e2[2] * cos_az]
            
            # Cross product pointing outward (e2_w x e1_w due to vertex index swap)
            fn = [
                e2_w[1] * e1_w[2] - e2_w[2] * e1_w[1],
                e2_w[2] * e1_w[0] - e2_w[0] * e1_w[2],
                e2_w[0] * e1_w[1] - e2_w[1] * e1_w[0]
            ]
            fn_len = math.sqrt(sum(x*x for x in fn)) or 1.0
            wn = [x / fn_len for x in fn]
            
            # Sun lighting calculation:
            sun_dot = max(0.0, wn[0]*sun_dir[0] + wn[1]*sun_dir[1] + wn[2]*sun_dir[2])
            sky_dot = max(0.0, wn[0]*sky_dir[0] + wn[1]*sky_dir[1] + wn[2]*sky_dir[2])
            
            # Vibrant outdoor park daylight:
            # - Base ambient floor: 0.86 keeps colours bright and light (no muddy grey shadows)
            # - Direct sun: up to +0.38 intensity on sunlit faces
            # - Sky bounce: +0.14 fill
            light_mult = 0.86 + 0.38 * sun_dot + 0.14 * sky_dot
            
            # Specular / highlight shimmer on upward facing voxel planes (matching Voxel Art .38 white opacity highlights)
            top_highlight = 1.0 + (0.16 * max(0.0, wn[1]))
            
            final_mult = light_mult * top_highlight
            
            fr = min(255, int(cr * final_mult))
            fg = min(255, int(cg * final_mult))
            fb = min(255, int(cb * final_mult))
            
            min_px = max(0, int(min(p0[0], p1[0], p2[0])))
            max_px = min(img_size - 1, int(max(p0[0], p1[0], p2[0])))
            min_py = max(0, int(min(p0[1], p1[1], p2[1])))
            max_py = min(img_size - 1, int(max(p0[1], p1[1], p2[1])))
            
            area = det
            for py in range(min_py, max_py + 1):
                for px in range(min_px, max_px + 1):
                    w0 = (p1[0] - px) * (p2[1] - py) - (p1[1] - py) * (p2[0] - px)
                    w1 = (p2[0] - px) * (p0[1] - py) - (p2[1] - py) * (p0[0] - px)
                    w2 = (p0[0] - px) * (p1[1] - py) - (p0[1] - py) * (p1[0] - px)
                    
                    if w0 >= 0 and w1 >= 0 and w2 >= 0:
                        pz = (w0 * p0[2] + w1 * p1[2] + w2 * p2[2]) / area
                        buf_idx = py * img_size + px
                        if pz > zbuffer[buf_idx]:
                            zbuffer[buf_idx] = pz
                            fb_idx = buf_idx * 4
                            framebuffer[fb_idx] = fr
                            framebuffer[fb_idx+1] = fg
                            framebuffer[fb_idx+2] = fb
                            framebuffer[fb_idx+3] = 255
                            
    return encode_png_data_url(img_size, img_size, framebuffer)

def main():
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    atlas_path = os.path.join(repo_root, 'assets/cubeworld-src/Atlas.png')
    animals_dir = os.path.join(repo_root, 'assets/cubeworld-src/Animals/OBJ')
    output_path = os.path.join(repo_root, 'data/cubeworld_pets.json')

    if not os.path.exists(atlas_path):
        print(f"Error: Atlas not found at {atlas_path}", file=sys.stderr)
        sys.exit(1)

    atlas_w, atlas_h, atlas_px = decode_png(atlas_path)

    # 1. Compute unified 3D world scale based on the Horse model (largest animal)
    horse_obj = os.path.join(animals_dir, 'Horse.obj')
    horse_v, _, _, _ = parse_obj(horse_obj)
    horse_max_dim = max(
        max(pt[0] for pt in horse_v) - min(pt[0] for pt in horse_v),
        max(pt[1] for pt in horse_v) - min(pt[1] for pt in horse_v),
        max(pt[2] for pt in horse_v) - min(pt[2] for pt in horse_v)
    )
    
    # Horse fills ~88% of 128px canvas; all other animals scale proportionally
    img_size = 128
    unified_world_scale = (img_size * 0.88) / horse_max_dim
    print(f"Unified 3D World Scale: {unified_world_scale:.2f} px/unit (Horse max dim = {horse_max_dim:.2f}m)")

    models = ['Dog', 'Cat', 'Chicken', 'Chick', 'Horse', 'Pig', 'Sheep', 'Wolf', 'Raccoon']
    sprites_data = {}

    for name in models:
        path = os.path.join(animals_dir, f'{name}.obj')
        if not os.path.exists(path):
            print(f"Warning: {path} not found, skipping.", file=sys.stderr)
            continue
            
        v, vt, vn, faces = parse_obj(path)
        animal_key = name.lower()
        
        sprites_data[animal_key] = {
            'default': render_mesh(v, vt, vn, faces, atlas_w, atlas_h, atlas_px,
                                   img_size=img_size, world_scale=unified_world_scale,
                                   leg_swing=0, head_pitch=0),
            'idle2': render_mesh(v, vt, vn, faces, atlas_w, atlas_h, atlas_px,
                                 img_size=img_size, world_scale=unified_world_scale,
                                 leg_swing=0, head_pitch=-0.2),
            'walk1': render_mesh(v, vt, vn, faces, atlas_w, atlas_h, atlas_px,
                                 img_size=img_size, world_scale=unified_world_scale,
                                 leg_swing=0.45, head_pitch=0.1),
            'walk2': render_mesh(v, vt, vn, faces, atlas_w, atlas_h, atlas_px,
                                 img_size=img_size, world_scale=unified_world_scale,
                                 leg_swing=-0.45, head_pitch=-0.1),
            'cheer': render_mesh(v, vt, vn, faces, atlas_w, atlas_h, atlas_px,
                                 img_size=img_size, world_scale=unified_world_scale,
                                 y_offset=0.25, leg_swing=0.2, head_pitch=0.3)
        }
        print(f"Rendered {name:8s} with proportional 3D world scale and bright outdoor lighting")

    with open(output_path, 'w') as f:
        json.dump(sprites_data, f, indent=2)

    print(f"\nSuccessfully generated {output_path} with {len(sprites_data)} pet species!")

if __name__ == '__main__':
    main()
