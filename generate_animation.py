import os
import math
from PIL import Image, ImageDraw, ImageFont

def make_gif():
    # Setup directories
    output_dir = r"C:\Users\quinn\.gemini\antigravity\scratch\periish.lol\public\assets"
    os.makedirs(output_dir, exist_ok=True)
    gif_path = os.path.join(output_dir, "animated_logo.gif")
    artifact_path = r"C:\Users\quinn\.gemini\antigravity\brain\241c45fe-9814-4051-b14a-05f8f533e461\animated_logo.gif"

    # Frame properties
    w, h = 400, 400
    frames = []
    num_frames = 40

    # Draw geometric coordinates
    cx, cy = 200, 170
    r = 75 # Outer radius
    
    # 6 vertices of a hexagon
    pts = []
    for i in range(6):
        angle = math.radians(30 + i * 60)
        pts.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    
    # Inner points for wireframe structure
    pts_inner = []
    r_inner = 35
    for i in range(6):
        angle = math.radians(30 + i * 60)
        pts_inner.append((cx + r_inner * math.cos(angle), cy + r_inner * math.sin(angle)))

    for f in range(num_frames):
        # Create base frame image
        img = Image.new("RGBA", (w, h), (3, 3, 3, 255)) # Dark background
        draw = ImageDraw.Draw(img)

        # Progress fraction 0.0 to 1.0
        t = f / num_frames
        
        # Calculate shimmer sweep position (x-coordinate sweep from -150 to 550)
        shimmer_x = -150 + t * 700
        
        # Helper function to get color based on shimmer proximity (soft white glow sweep)
        def get_line_color(x1, y1, x2, y2):
            mid_x = (x1 + x2) / 2
            dist = abs(mid_x - shimmer_x)
            if dist < 60:
                # Highlight glow
                glow_factor = (1.0 - (dist / 60))
                val = int(80 + glow_factor * 175) # 80 to 255
                return (val, val, val, 255)
            # Default minimal grey
            return (70, 70, 70, 255)

        # Draw Outer Hexagon lines
        for i in range(6):
            next_i = (i + 1) % 6
            x1, y1 = pts[i]
            x2, y2 = pts[next_i]
            draw.line([x1, y1, x2, y2], fill=get_line_color(x1, y1, x2, y2), width=2)

        # Draw Inner Hexagon lines
        for i in range(6):
            next_i = (i + 1) % 6
            x1, y1 = pts_inner[i]
            x2, y2 = pts_inner[next_i]
            draw.line([x1, y1, x2, y2], fill=get_line_color(x1, y1, x2, y2), width=1)

        # Draw connector lines (wireframe cube style)
        for i in range(6):
            x1, y1 = pts[i]
            x2, y2 = pts_inner[i]
            draw.line([x1, y1, x2, y2], fill=get_line_color(x1, y1, x2, y2), width=1)
            
            # Connect alternate vertices to center
            if i % 2 == 0:
                draw.line([pts_inner[i][0], pts_inner[i][1], cx, cy], fill=get_line_color(cx, cy, pts_inner[i][0], pts_inner[i][1]), width=1)

        # Draw clean professional text "periish.lol"
        text = "periish.lol"
        # Try loading system font, else fallback to default
        try:
            font = ImageFont.truetype("arial.ttf", 26)
        except IOError:
            font = ImageFont.load_default()

        # Center text horizontally
        # getbbox returns (left, top, right, bottom)
        bbox = draw.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
        tx = (w - text_w) // 2
        ty = 290
        
        # Calculate text shimmer
        text_mid = tx + (text_w / 2)
        text_dist = abs(text_mid - shimmer_x)
        if text_dist < 80:
            glow = (1.0 - (text_dist / 80))
            text_val = int(120 + glow * 135)
            text_color = (text_val, text_val, text_val, 255)
        else:
            text_color = (120, 120, 120, 255)

        draw.text((tx, ty), text, fill=text_color, font=font)

        # Draw a subtle minimal progress accent line under the text
        line_y = ty + text_h + 12
        line_w = 40
        line_x1 = (w - line_w) // 2
        line_x2 = line_x1 + line_w
        draw.line([line_x1, line_y, line_x2, line_y], fill=(60, 60, 60, 255), width=1)
        
        # Shimmer on progress accent line
        line_mid = (line_x1 + line_x2) / 2
        line_dist = abs(line_mid - shimmer_x)
        if line_dist < 40:
            lglow = (1.0 - (line_dist / 40))
            lval = int(60 + lglow * 120)
            draw.line([line_x1, line_y, line_x2, line_y], fill=(lval, lval, lval, 255), width=1)

        frames.append(img)

    # Save animated GIF
    frames[0].save(
        gif_path,
        save_all=True,
        append_images=frames[1:],
        duration=40,  # 40ms per frame = 25fps
        loop=0
    )
    
    # Save a copy to artifacts directory for clickable user presentation
    shutil_copy(gif_path, artifact_path)
    print("GIF generated successfully at:", gif_path)

def shutil_copy(src, dst):
    import shutil
    shutil.copy(src, dst)

if __name__ == "__main__":
    make_gif()
