import os
import math
from PIL import Image, ImageDraw

def make_p_gif():
    output_dir = r"C:\Users\quinn\.gemini\antigravity\scratch\periish.lol\public\assets"
    os.makedirs(output_dir, exist_ok=True)
    gif_path = os.path.join(output_dir, "animated_p.gif")
    artifact_path = r"C:\Users\quinn\.gemini\antigravity\brain\241c45fe-9814-4051-b14a-05f8f533e461\animated_p.gif"

    w, h = 400, 400
    frames = []
    num_frames = 60 # Smoother animation (60 frames)

    # 13 front-layer vertices for a perfectly proportioned, chamfered geometric letter P
    f_stem_bottom_l = (155, 290)
    f_stem_bottom_r = (185, 290)
    f_stem_top_l = (155, 110)
    f_stem_top_r = (185, 110)
    
    f_loop_top_mid = (225, 110)
    f_loop_top_corner = (245, 130)
    f_loop_bottom_corner = (245, 180)
    f_loop_bottom_mid = (225, 200)
    f_loop_inner_l = (185, 200)
    
    f_hole_top_l = (185, 135)
    f_hole_top_r = (215, 135)
    f_hole_bottom_r = (215, 175)
    f_hole_bottom_l = (185, 175)

    front_vertices = [
        f_stem_bottom_l, f_stem_bottom_r, f_stem_top_l, f_stem_top_r,
        f_loop_top_mid, f_loop_top_corner, f_loop_bottom_corner, f_loop_bottom_mid,
        f_loop_inner_l, f_hole_top_l, f_hole_top_r, f_hole_bottom_r, f_hole_bottom_l
    ]

    # Extrusion offset for premium isometric depth
    dx, dy = 14, -14
    back_vertices = [(x + dx, y + dy) for (x, y) in front_vertices]

    # Connections definitions for a clean geometric structure
    front_edges = [
        # Stem outer bounds
        (0, 1), (0, 2), (2, 3), (1, 8),
        # Loop chamfered outer bounds
        (3, 4), (4, 5), (5, 6), (6, 7), (7, 8),
        # Inner loop hole bounds
        (9, 10), (10, 11), (11, 12), (12, 9)
    ]
    
    connectors = list(range(len(front_vertices)))

    for f in range(num_frames):
        # Canvas with pure black background
        img = Image.new("RGBA", (w, h), (0, 0, 0, 255))
        draw = ImageDraw.Draw(img)

        # Loop progress
        t = f / num_frames
        
        # Diagonal sweep: y = -x + c
        shimmer_c = 40 + t * 720

        # Helper function for smooth vector gradient color based on sweep proximity
        def get_edge_color(p1, p2, is_back=False):
            mx = (p1[0] + p2[0]) / 2
            my = (p1[1] + p2[1]) / 2
            dist = abs((mx + my) - shimmer_c)
            
            if dist < 85:
                # Cosine-tapered smooth glow transition
                glow = 0.5 + 0.5 * math.cos((dist / 85) * math.pi)
                if is_back:
                    val = int(55 + glow * 135) # 55 to 190
                    return (val, val, val, 255)
                else:
                    val = int(140 + glow * 115) # 140 to 255
                    return (val, val, val, 255)
            
            # Default elegant resting states
            if is_back:
                return (55, 55, 55, 255) # Sleek dark grey depth
            else:
                return (140, 140, 140, 255) # Clean medium white/grey outlines

        # Draw Back Layer (depth lines)
        for e in front_edges:
            p1 = back_vertices[e[0]]
            p2 = back_vertices[e[1]]
            draw.line([p1, p2], fill=get_edge_color(p1, p2, is_back=True), width=1)

        # Draw Connections
        for idx in connectors:
            p1 = front_vertices[idx]
            p2 = back_vertices[idx]
            draw.line([p1, p2], fill=get_edge_color(p1, p2, is_back=True), width=1)

        # Draw Front Layer
        for e in front_edges:
            p1 = front_vertices[e[0]]
            p2 = front_vertices[e[1]]
            draw.line([p1, p2], fill=get_edge_color(p1, p2, is_back=False), width=2)

        frames.append(img)

    # Save animated GIF
    frames[0].save(
        gif_path,
        save_all=True,
        append_images=frames[1:],
        duration=33, # ~30fps for ultra-smooth fluidity
        loop=0
    )
    
    # Save a copy to artifacts directory
    import shutil
    shutil.copy(gif_path, artifact_path)
    print("Clean 3D P GIF generated successfully at:", gif_path)

if __name__ == "__main__":
    make_p_gif()
